// Manages talk bubble state: which message to show, when, interaction tracking
import { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  nudgeReducer, initialNudgeState,
  type Section,
} from '@/lib/atlas-trigger-state';

interface BubbleMessage {
  id: string;
  text: string;
  context: string; // which page/section this applies to
}

const BUBBLE_MESSAGES: BubbleMessage[] = [
  // Planner landing
  { id: 'planner-intro', text: "Hey! I'm Atlas, your travel concierge. Need help planning?", context: 'planner' },
  { id: 'planner-destination', text: "Can't decide where to go? Tell me what vibe you're looking for", context: 'planner' },
  { id: 'planner-explore', text: "Nice picks! When you're ready, hit the button and I'll craft your perfect trip", context: 'planner' },
  { id: 'planner-budget', text: "Tip: toggle 'Let Atlas find the cheapest dates' and I'll do the date math for you", context: 'planner' },
  // Itinerary page
  { id: 'itinerary-empty', text: "Your itinerary looks empty — want me to suggest some activities?", context: 'itinerary' },
  { id: 'itinerary-idle', text: "Need a hand? I can search flights or point you to the right guide", context: 'itinerary' },
  { id: 'itinerary-interests', text: "Tap the mic and tell me what you're into — it's faster!", context: 'itinerary' },
];

export function useAtlasBubble(isAtlasOpen: boolean) {
  const [currentBubble, setCurrentBubble] = useState<BubbleMessage | null>(null);
  const [interactionCount, setInteractionCount] = useState(0);
  const pathname = usePathname();
  const tNudge = useTranslations('tripFormNudge');
  const [nudgeState, nudgeDispatch] = useReducer(nudgeReducer, initialNudgeState);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownRef = useRef(false);
  const lastShownRef = useRef<number>(0);

  // Determine page context
  const pageContext = pathname?.includes('/planner/') && pathname.split('/').length > 3
    ? 'itinerary' : pathname?.includes('/planner') ? 'planner' : 'other';

  // Check if a bubble ID was already shown this session (per trip)
  const getStorageKey = useCallback(() => {
    const tripMatch = pathname?.match(/\/planner\/(\d+)/);
    return tripMatch ? `atlas_bubbles_${tripMatch[1]}` : 'atlas_bubbles_global';
  }, [pathname]);

  const wasShown = useCallback((id: string) => {
    try {
      const shown = JSON.parse(sessionStorage.getItem(getStorageKey()) || '[]');
      return shown.includes(id);
    } catch { return false; }
  }, [getStorageKey]);

  const markShown = useCallback((id: string) => {
    try {
      const shown = JSON.parse(sessionStorage.getItem(getStorageKey()) || '[]');
      if (!shown.includes(id)) {
        shown.push(id);
        sessionStorage.setItem(getStorageKey(), JSON.stringify(shown));
      }
    } catch {}
  }, [getStorageKey]);

  // Check localStorage for first-time ever
  const isFirstTimeEver = useCallback(() => {
    return !localStorage.getItem('atlas_introduced');
  }, []);

  const markIntroduced = useCallback(() => {
    localStorage.setItem('atlas_introduced', '1');
  }, []);

  // Increment interaction counter
  const trackInteraction = useCallback(() => {
    setInteractionCount(c => c + 1);
  }, []);

  // Dismiss current bubble
  const dismissBubble = useCallback(() => {
    setCurrentBubble(null);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  // Try to show a bubble
  const tryShowBubble = useCallback(() => {
    if (isAtlasOpen || cooldownRef.current || currentBubble) return;

    // Enforce 30s cooldown between bubbles
    const now = Date.now();
    if (now - lastShownRef.current < 30000) return;

    // Determine threshold based on first-time vs returning
    const threshold = isFirstTimeEver() ? 2 : 3;
    if (interactionCount < threshold) return;

    // Find first unshown message for current context
    const candidates = BUBBLE_MESSAGES.filter(
      m => m.context === pageContext && !wasShown(m.id)
    );

    // First-time intro gets priority
    if (isFirstTimeEver() && !wasShown('planner-intro')) {
      const intro = BUBBLE_MESSAGES.find(m => m.id === 'planner-intro');
      if (intro) {
        setCurrentBubble(intro);
        markShown(intro.id);
        markIntroduced();
        lastShownRef.current = now;
        // Auto-dismiss after 8 seconds
        dismissTimerRef.current = setTimeout(() => setCurrentBubble(null), 8000);
        return;
      }
    }

    if (candidates.length === 0) return;

    const msg = candidates[0];
    setCurrentBubble(msg);
    markShown(msg.id);
    lastShownRef.current = now;
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, 30000);
    dismissTimerRef.current = setTimeout(() => setCurrentBubble(null), 8000);
  }, [isAtlasOpen, currentBubble, interactionCount, pageContext, wasShown, markShown, isFirstTimeEver, markIntroduced]);

  // Trigger bubble check when interaction count changes
  useEffect(() => {
    if (interactionCount > 0) tryShowBubble();
  }, [interactionCount, tryShowBubble]);

  // Idle timer: show bubble after 30s of no interaction on itinerary page
  useEffect(() => {
    if (pageContext !== 'itinerary' || isAtlasOpen) return;

    const idleTimer = setTimeout(() => {
      if (!currentBubble && !isAtlasOpen) {
        const idleMsg = BUBBLE_MESSAGES.find(m => m.id === 'itinerary-idle' && !wasShown(m.id));
        if (idleMsg) {
          setCurrentBubble(idleMsg);
          markShown(idleMsg.id);
          lastShownRef.current = Date.now();
          dismissTimerRef.current = setTimeout(() => setCurrentBubble(null), 8000);
        }
      }
    }, 30000);

    return () => clearTimeout(idleTimer);
  }, [pageContext, isAtlasOpen, currentBubble, wasShown, markShown]);

  // Idle timer: section-aware nudges for planner landing page
  useEffect(() => {
    if (pageContext !== 'planner' || isAtlasOpen) return;

    // Update nudge section from window.__atlasFormContext
    const section = detectSection(window.__atlasFormContext ?? null);
    if (section) {
      nudgeDispatch({ type: 'setSection', section, now: Date.now() });
    }

    // Tick every 5s to check idle time
    const tickInterval = setInterval(() => {
      nudgeDispatch({ type: 'tick', now: Date.now() });
    }, 5000);

    return () => clearInterval(tickInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageContext, isAtlasOpen]);

  // Emit bubble when nudge state has a pending nudge
  useEffect(() => {
    if (!nudgeState.pendingNudge || currentBubble || isAtlasOpen) return;
    const nudgeKey = nudgeState.pendingNudge;
    const nudgeText = tNudge(nudgeKey as any);
    if (!nudgeText) return;
    const nudgeMsg: BubbleMessage = { id: `nudge-${nudgeKey}`, text: nudgeText, context: 'planner' };
    setCurrentBubble(nudgeMsg);
    nudgeDispatch({ type: 'consumeNudge' });
    lastShownRef.current = Date.now();
    dismissTimerRef.current = setTimeout(() => setCurrentBubble(null), 8000);
  }, [nudgeState.pendingNudge, currentBubble, isAtlasOpen, tNudge]);

  // Dismiss when Atlas opens
  useEffect(() => {
    if (isAtlasOpen) dismissBubble();
  }, [isAtlasOpen, dismissBubble]);

  // Listen for global atlas-interaction events (from ItineraryBuilder / TripForm)
  useEffect(() => {
    const handler = () => {
      trackInteraction();
      // Also reset nudge idle timer on planner page
      if (pageContext === 'planner') {
        nudgeDispatch({ type: 'interaction', now: Date.now() });
        // Re-detect section since form state may have changed
        const section = detectSection(window.__atlasFormContext ?? null);
        if (section) {
          nudgeDispatch({ type: 'setSection', section, now: Date.now() });
        }
      }
    };
    window.addEventListener('atlas-interaction', handler);
    return () => window.removeEventListener('atlas-interaction', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackInteraction, pageContext]);

  // Click-outside handler to dismiss bubble
  useEffect(() => {
    if (!currentBubble) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-atlas-bubble]')) return;
      dismissBubble();
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [currentBubble, dismissBubble]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current); };
  }, []);

  return {
    currentBubble,
    dismissBubble,
    trackInteraction,
  };
}

// ── Section detection helper ─────────────────────────────────────────────────
// Reads from window.__atlasFormContext (set by TripForm) to determine which
// planner section the user is on, for section-aware idle nudges.

function detectSection(ctx: { mode?: string; origin?: string; destination?: string; vibes?: string[]; interests?: string[] } | null): Section | null {
  if (!ctx) return null;
  if (ctx.mode === 'chooser') return 'chooser';
  if (ctx.mode === 'flight') {
    if (!ctx.origin) return 'flight-no-origin';
    if (!ctx.destination) return 'flight-no-destination';
    return 'complete';
  }
  if (ctx.mode === 'explore') {
    if (!ctx.vibes || ctx.vibes.length === 0) return 'explore-no-vibes';
    if (!ctx.interests || ctx.interests.length < 2) return 'explore-no-interests';
    return 'complete';
  }
  return null;
}
