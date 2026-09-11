"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useAtlasBubble } from "@/hooks/useAtlasBubble";
import { useAssistantHealth } from "@/hooks/useAssistantHealth";
import { useAtlasTrigger } from "@/hooks/useAtlasTrigger";
import { decodeSseData } from "@/lib/atlas/sse";
import { buildOnboardingIntro, readGuestPrefs } from "@/lib/guest-prefs";
import AtlasSmartSearchChip from "./AtlasSmartSearchChip";
import VoiceInput from "./VoiceInput";
import FlightCard from "./atlas/FlightCard";
import DealCard from "./atlas/DealCard";
import DestinationCard from "./atlas/DestinationCard";
import ArticleCard from "./atlas/ArticleCard";
import TripResultsModal from "./atlas/TripResultsModal";
import type { FlightResult, BudgetTier } from "./atlas/types";
import { PRICE_UNKNOWN, DURATION_UNKNOWN } from "./atlas/types";

// ── Trip tools ───────────────────────────────────────────────────────────────
// Results from these tools are collected into the results window rather than
// rendered as inline cards. Opening the window is gated on usable results (see
// `hasTripResults`), not on this set.

const TRIP_TOOLS = new Set(["search_flights"]);

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

interface TripContextItem {
  day: number;
  category: string;
  title: string;
  price_estimate: number | null;
}

interface TripContext {
  destination: string;
  dates?: { start: string; end: string };
  adults: number;
  budgetTier: BudgetTier;
  tripId?: number;
  items?: TripContextItem[];
  isGuest?: boolean;
  flexibleWindow?: string;
  tripLength?: string;
  origin?: string;
  interests?: string[];
  nearbyAirports?: string[];
}

interface ModalData {
  flights: FlightResult[];
  tripContext: TripContext;
}

// ── Quick-action chips ───────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "Search flights", emoji: "\u2708\uFE0F", message: "Search flights for me" },
  { label: "Find hotels", emoji: "\uD83C\uDFE8", message: "Find me hotels" },
  { label: "Find restaurants", emoji: "\uD83C\uDF7D\uFE0F", message: "Find restaurants near my destination" },
  { label: "Search activities", emoji: "\uD83C\uDFAF", message: "Search activities and things to do" },
  { label: "Surprise me", emoji: "\uD83C\uDFB2", message: "Surprise me with 3 destination ideas" },
  { label: "Recommend an article", emoji: "\uD83D\uDCD6", message: "Recommend a travel guide article" },
];

// ── Helper: parse tool results from message content ──────────────────────────

interface ToolResult {
  type: "text" | "tool";
  toolName?: string;
  data?: Record<string, unknown>;
  text?: string;
}

function parseMessageContent(content: string): ToolResult[] {
  const parts: ToolResult[] = [];
  const markerPattern = /\[TOOL:(\w+)\]/g;

  let lastIndex = 0;
  let match;

  while ((match = markerPattern.exec(content)) !== null) {
    // Text before this tool marker
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) parts.push({ type: "text", text });
    }

    const toolName = match[1];
    const jsonStart = match.index + match[0].length;

    // Find matching JSON using brace counting (handles nested objects)
    if (jsonStart < content.length && content[jsonStart] === "{") {
      let depth = 0;
      let jsonEnd = jsonStart;
      for (let i = jsonStart; i < content.length; i++) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") {
          depth--;
          if (depth === 0) { jsonEnd = i + 1; break; }
        }
      }
      const jsonStr = content.slice(jsonStart, jsonEnd);
      try {
        const data = JSON.parse(jsonStr);
        parts.push({ type: "tool", toolName, data });
      } catch {
        parts.push({ type: "text", text: match[0] + jsonStr });
      }
      lastIndex = jsonEnd;
      markerPattern.lastIndex = jsonEnd;
    } else {
      parts.push({ type: "text", text: match[0] });
      lastIndex = match.index + match[0].length;
    }
  }

  // Remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) parts.push({ type: "text", text });
  }

  return parts.length > 0 ? parts : [{ type: "text", text: content }];
}

// ── Helpers: parse numeric values from price strings + duration ──────────────

function parsePriceValue(priceStr: string): number {
  const match = priceStr.replace(/,/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

function parseDurationMinutes(durationStr: string): number {
  const hMatch = durationStr.match(/(\d+)h/);
  const mMatch = durationStr.match(/(\d+)m/);
  return (hMatch ? parseInt(hMatch[1]) * 60 : 0) + (mMatch ? parseInt(mMatch[1]) : 0);
}

/** Extract typed arrays from parsed tool results */
export function extractTripData(parts: ToolResult[]): {
  flights: FlightResult[];
} {
  const flights: FlightResult[] = [];

  for (const p of parts) {
    if (p.type !== "tool" || !p.data) continue;

    if (p.toolName === "search_flights" && Array.isArray(p.data.flights)) {
      for (const f of p.data.flights as Record<string, unknown>[]) {
        const priceRaw = typeof f.price === "string" ? f.price.trim() : "";
        const price = priceRaw || "price unavailable";
        const durationRaw = typeof f.duration === "string" ? f.duration.trim() : "";
        const duration = durationRaw || "duration unavailable";
        const stops = String(f.stops || "");
        const parsedPrice = typeof f.price_value === "number" ? f.price_value : parsePriceValue(price);
        flights.push({
          airline: String(f.airline || ""),
          route: String(f.route || ""),
          price,
          price_value: parsedPrice > 0 ? parsedPrice : PRICE_UNKNOWN,
          duration,
          duration_minutes:
            typeof f.duration_minutes === "number"
              ? f.duration_minutes
              : durationRaw
                ? parseDurationMinutes(durationRaw)
                : DURATION_UNKNOWN,
          stops,
          nonstop: typeof f.nonstop === "boolean" ? f.nonstop : /nonstop/i.test(stops),
          depart_date: f.depart_date ? String(f.depart_date) : undefined,
          return_date: f.return_date ? String(f.return_date) : undefined,
          book_url: String(f.book_url || ""),
        });
      }
    }

  }

  return { flights };
}

/** Read trip context from the #atlas-trip-context script tag */
function readTripContext(): TripContext {
  const defaults: TripContext = {
    destination: "your destination",
    adults: 1,
    budgetTier: "mid",
  };

  try {
    const el = document.getElementById("atlas-trip-context");
    if (!el) return defaults;
    const data = JSON.parse(el.textContent || "{}");
    const budgetMap: Record<string, BudgetTier> = { budget: "budget", midrange: "mid", mid: "mid", luxury: "luxury" };
    const budgetTier = (budgetMap[data.budget] || "mid") as BudgetTier;
    const startVal = data.dates?.start ?? data.startDate ?? data.start_date;
    const endVal = data.dates?.end ?? data.endDate ?? data.end_date;
    const dates = startVal && endVal ? { start: startVal as string, end: endVal as string } : undefined;
    return {
      destination: data.destination || defaults.destination,
      dates,
      adults: data.adults || data.travelers_adults || defaults.adults,
      budgetTier,
      tripId: data.tripId || data.trip_id || data.id,
      items: Array.isArray(data.items) ? data.items : undefined,
      isGuest: data.isGuest === true,
      flexibleWindow: data.flexibleWindow || data.flexible_window || undefined,
      tripLength: data.tripLength || data.trip_length || undefined,
      origin: data.origin || undefined,
      interests: Array.isArray(data.interests) ? data.interests : undefined,
      nearbyAirports: Array.isArray(data.nearbyAirports) ? data.nearbyAirports : undefined,
    };
  } catch {
    return defaults;
  }
}

/** Get text-only summary from parsed parts (strips tool JSON) */
function getTextSummary(parts: ToolResult[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ")
    .trim();
}

// ── Tool card renderers using dedicated card components ──────────────────────

function ToolResultCards({ toolName, data }: { toolName: string; data: Record<string, unknown> }) {
  // Contained tool failures (is_error results from executeToolSafely) are
  // explained by Atlas's own follow-up text — don't render a raw JSON card.
  if (data.is_error) return null;

  if (toolName === "search_flights" && data.flights) {
    const flights = data.flights as Array<Record<string, string>>;
    return (
      <div className="space-y-2 my-2">
        {flights.map((f, i) => (
          <FlightCard key={i} flight={f as never} />
        ))}
      </div>
    );
  }

  if (toolName === "get_deals" && data.deals) {
    const deals = data.deals as Array<Record<string, unknown>>;
    return (
      <div className="space-y-2 my-2">
        {deals.map((d, i) => (
          <DealCard key={i} deal={d as never} />
        ))}
      </div>
    );
  }

  if (toolName === "surprise_me" && data.suggestions) {
    const suggestions = data.suggestions as Array<Record<string, unknown>>;
    return (
      <div className="space-y-2 my-2">
        {suggestions.map((s, i) => (
          <DestinationCard key={i} destination={s as never} />
        ))}
      </div>
    );
  }

  if (toolName === "get_article" && data.articles) {
    const articles = data.articles as Array<Record<string, string>>;
    return (
      <div className="space-y-2 my-2">
        {articles.map((a, i) => (
          <ArticleCard key={i} article={a as never} />
        ))}
      </div>
    );
  }

  // Fallback: show raw JSON
  return (
    <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto my-2">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// ── Markdown-lite renderer ───────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdownLite(text: string) {
  // Escape HTML first to prevent XSS — content comes from the LLM, which could
  // theoretically output raw HTML or be influenced by prompt injection.
  let html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Links — only allow http(s) URLs to prevent javascript: protocol injection
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" class="text-orange-600 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // Also handle relative URLs (for TPI article links like /slug/)
  html = html.replace(
    /\[([^\]]+)\]\((\/[^)]+)\)/g,
    '<a href="$2" class="text-orange-600 hover:underline">$1</a>'
  );

  // Table detection and conversion (before newline→br)
  const lines = html.split("\n");
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerCells = tableLines[0].split("|").filter(c => c.trim() !== "").map(c => c.trim());

        let dataStart = 1;
        if (tableLines[1] && /^\|[\s\-:|]+\|$/.test(tableLines[1])) {
          dataStart = 2;
        }

        let tableHtml = '<table class="w-full text-xs border-collapse rounded-lg overflow-hidden my-3">';
        tableHtml += '<thead><tr class="bg-orange-50">';
        for (const cell of headerCells) {
          tableHtml += `<th class="px-3 py-2 text-left font-semibold text-gray-700 border-b border-orange-200">${cell}</th>`;
        }
        tableHtml += "</tr></thead><tbody>";

        for (let r = dataStart; r < tableLines.length; r++) {
          const cells = tableLines[r].split("|").filter(c => c.trim() !== "").map(c => c.trim());
          const rowClass = (r - dataStart) % 2 === 0 ? "bg-white" : "bg-gray-50";
          tableHtml += `<tr class="${rowClass}">`;
          for (const cell of cells) {
            tableHtml += `<td class="px-3 py-2 text-gray-700 border-b border-gray-100">${cell}</td>`;
          }
          tableHtml += "</tr>";
        }
        tableHtml += "</tbody></table>";
        result.push(tableHtml);
      } else {
        for (const line of tableLines) {
          result.push(line + "<br/>");
        }
      }
    } else {
      result.push(lines[i] + "<br/>");
      i++;
    }
  }

  html = result.join("");
  // Remove trailing br
  html = html.replace(/(<br\/>)+$/, "");
  return html;
}

// ── Auto-search prompt builder (extracted from former 800ms auto-trigger) ────
// Pure function — no React, no side effects.

function buildAutoSearchPrompt(ctx: {
  destination: string;
  dates?: { start: string; end: string };
  flexibleWindow?: string;
  tripLength?: string;
}): string {
  const windowLabels: Record<string, string> = {
    next_2_weeks: "in the next 2 weeks",
    next_month: "next month",
    "2_3_months": "in 2-3 months",
    "6_months": "in about 6 months",
    this_year: "sometime this year",
    any: "whenever it's cheapest",
  };
  const lengthLabels: Record<string, string> = {
    weekend: "a weekend (2-3 days)",
    week: "about a week",
    "10_14_days": "10-14 days",
    "2_plus_weeks": "2+ weeks",
    any: "however long gives the best deal",
  };

  let prompt = `I just created a trip to ${ctx.destination}`;
  if (ctx.dates) {
    prompt += ` from ${ctx.dates.start} to ${ctx.dates.end}`;
  } else if (ctx.flexibleWindow || ctx.tripLength) {
    const when = ctx.flexibleWindow ? windowLabels[ctx.flexibleWindow] || ctx.flexibleWindow : "flexible dates";
    const howLong = ctx.tripLength ? lengthLabels[ctx.tripLength] || ctx.tripLength : "flexible duration";
    prompt += `. I'm flexible on dates — thinking ${when}, for ${howLong}`;
  }
  prompt += ". Search flights, hotels, and activities for me.";
  return prompt;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AssistantChat() {
  const t = useTranslations("assistant");
  const [isOpen, setIsOpen] = useState(false);
  const [isModalMode, setIsModalMode] = useState(false);

  // ── Talk bubble ──────────────────────────────────────────────────────────
  const { currentBubble, dismissBubble } = useAtlasBubble(isOpen);
  const { healthy: assistantHealthy } = useAssistantHealth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [hasBouncedOnce, setHasBouncedOnce] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<ModalData | null>(null);

  // ── Trip context for trigger governance ──────────────────────────────────
  const [tripCtx, setTripCtx] = useState<TripContext>(() => ({
    destination: "your destination",
    adults: 1,
    budgetTier: "mid",
  }));

  // ── Portal slot for consent chip ─────────────────────────────────────────
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById('atlas-smart-search-slot'));
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgIdCounter = useRef(0);
  const messagesLenRef = useRef(0);
  const sendMessageRef = useRef<(msg: string, opts?: { onDone?: () => void }) => void>(() => {});

  // ── Quiz escape hatch — open chat via custom event ───────────────────────
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener('open-atlas-chat', handler);
    return () => window.removeEventListener('open-atlas-chat', handler);
  }, []);

  // ── Session management ──────────────────────────────────────────────────

  const createSession = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant/sessions", { method: "POST" });
      if (!res.ok) return null;
      const data = await res.json();
      sessionStorage.setItem("atlas_session_id", data.id);
      setSessionId(data.id);
      return data.id;
    } catch {
      return null;
    }
  }, []);

  const loadHistory = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/assistant/history/${sid}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setMessages(
          data.map((m: { id: number; role: string; content: string }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
        msgIdCounter.current = Math.max(...data.map((m: { id: number }) => m.id), 0);
      }
    } catch {
      // Silently fail — fresh session
    }
  }, []);

  useEffect(() => {
    const storedSid = sessionStorage.getItem("atlas_session_id");
    if (storedSid) {
      setSessionId(storedSid);
      loadHistory(storedSid);
    }
    // Check bounce animation flag
    if (!localStorage.getItem("atlas_bounced")) {
      setHasBouncedOnce(true);
      localStorage.setItem("atlas_bounced", "1");
    }
  }, [loadHistory]);

  // Keep messagesLenRef in sync for auto-trigger closure
  messagesLenRef.current = messages.length;

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Listen for onboarding completion — trigger Atlas intro ───────────────

  useEffect(() => {
    const handleOnboardingComplete = (event: Event) => {
      if (event instanceof CustomEvent) {
        setIsOpen(true);
        setTimeout(() => {
          sendMessageRef.current(buildOnboardingIntro(event.detail));
        }, 300);
      }
    };

    window.addEventListener("atlas-onboarding-complete", handleOnboardingComplete);
    return () => window.removeEventListener("atlas-onboarding-complete", handleOnboardingComplete);
  }, []);

  // ── Listen for atlas-open events (Tell Me More, Show Different, etc.) ────

  useEffect(() => {
    const handleAtlasOpen = (event: Event) => {
      if (event instanceof CustomEvent) {
        const { message } = event.detail;
        setIsOpen(true);
        setIsModalMode(true);
        if (message) {
          // Auto-send the message after a brief delay
          setTimeout(() => {
            sendMessageRef.current(message);
          }, 300);
        }
      }
    };

    window.addEventListener("atlas-open", handleAtlasOpen);
    return () => window.removeEventListener("atlas-open", handleAtlasOpen);
  }, []);

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string, opts?: { onDone?: () => void }) => {
      if (!text.trim() || isLoading) return;

      setError(null);

      // Ensure session exists
      let sid = sessionId;
      if (!sid) {
        sid = await createSession();
        if (!sid) {
          setError("Could not start chat. Please refresh and try again.");
          return;
        }
      }

      // Add user message
      const userMsgId = ++msgIdCounter.current;
      const userMsg: ChatMessage = { id: userMsgId, role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      // Add placeholder assistant message
      const assistantMsgId = ++msgIdCounter.current;
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: "assistant", content: "", isStreaming: true },
      ]);

      try {
        // Build rich page context — include trip data if on itinerary page
        let pageContext = window.location.pathname + " | " + document.title;
        const tripContextEl = document.getElementById("atlas-trip-context");
        if (tripContextEl) {
          try {
            const tripData = JSON.parse(tripContextEl.textContent || "{}");
            // Build a concise trip summary instead of dumping raw JSON
            const dest = tripData.destination || "";
            const start = tripData.startDate || tripData.start_date || "";
            const end = tripData.endDate || tripData.end_date || "";
            const budget = tripData.budget || "";
            const adults = tripData.adults || 1;
            const origin = tripData.origin || "";
            const tripInterests = Array.isArray(tripData.interests) ? tripData.interests : [];
            const vibes = tripInterests.filter((i: string) => i.startsWith("vibe:")).map((i: string) => i.replace(/^vibe:(custom:)?/, ""));
            const pureInterests = tripInterests.filter((i: string) => !i.startsWith("vibe:")).map((i: string) => i.replace(/^custom:/, ""));
            pageContext += `\n\nActive trip: ${dest}, ${start || "flexible"} to ${end || "flexible"}, ${adults} adults, budget: ${budget}`;
            if (origin) pageContext += `\nDeparting from: ${origin}`;
            if (vibes.length) pageContext += `\nVibes: ${vibes.join(", ")}`;
            if (pureInterests.length) pageContext += `\nInterests: ${pureInterests.join(", ")}`;

            // Format existing itinerary items so Atlas can suggest complementary activities
            const items = tripData.items as Array<{ day: number; category: string; title: string; price_estimate: number | null }> | undefined;
            if (items && items.length > 0) {
              const byDay: Record<number, string[]> = {};
              for (const item of items) {
                if (!byDay[item.day]) byDay[item.day] = [];
                byDay[item.day].push(`${item.category}: ${item.title}${item.price_estimate != null ? ` ($${item.price_estimate})` : ""}`);
              }
              pageContext += "\nCurrent itinerary:";
              for (const [day, dayItems] of Object.entries(byDay).sort(([a], [b]) => Number(a) - Number(b))) {
                pageContext += `\n  Day ${day}: ${dayItems.join(", ")}`;
              }
            }
          } catch { /* ignore parse errors */ }
        }

        // Check for pre-submit form context (TripForm exposes this via window.__atlasFormContext)
        const formContext = window.__atlasFormContext;
        if (formContext) {
          const dest = formContext.destination || "";
          const isSurprise = formContext.surpriseMe;
          const vibes = (formContext.vibes || []).join(", ");
          const allInterests = (formContext.interests || []).join(", ");
          const budget = formContext.budget || "";
          const origin = formContext.origin || "";
          pageContext += `\n\nForm context (user is filling out TripForm):`;
          pageContext += `\n  Destination: ${isSurprise ? `Surprise Me (hint: ${dest})` : dest}`;
          if (isSurprise && vibes) pageContext += `\n  Vibes: ${vibes}`;
          if (allInterests) pageContext += `\n  Interests: ${allInterests}`;
          if (budget) pageContext += `\n  Budget: ${budget}`;
          if (origin) pageContext += `\n  Flying from: ${origin}`;
          if (formContext.adults) pageContext += `\n  Travelers: ${formContext.adults} adults, ${formContext.children || 0} children`;
        }

        const guestPrefs = readGuestPrefs();
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text.trim(),
            session_id: sid,
            page_context: pageContext,
            ...(guestPrefs ? { guest_prefs: guestPrefs } : {}),
          }),
        });

        if (res.status === 429) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: "Atlas has reached the daily limit. Try again tomorrow.", isStreaming: false }
                : m
            )
          );
          opts?.onDone?.();
          setIsLoading(false);
          return;
        }

        if (!res.ok || !res.body) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: "Connection lost. Please try again.", isStreaming: false }
                : m
            )
          );
          opts?.onDone?.();
          setIsLoading(false);
          return;
        }

        // Stream SSE
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";

          for (const frame of frames) {
            const data = decodeSseData(frame);
            if (data === null) continue;

            if (data === "[DONE]") continue;

            // Check for error
            if (data.startsWith("{\"error\"")) {
              try {
                const errObj = JSON.parse(data);
                const errText = errObj.error || "An error occurred.";
                fullText += (fullText && !/\s$/.test(fullText) ? "\n\n" : "") + errText;
              } catch {
                fullText += (fullText && !/\s$/.test(fullText) ? "\n\n" : "") + data;
              }
              continue;
            }

            // Tool result — append as-is (will be parsed by renderer)
            if (data.startsWith("[TOOL:")) {
              fullText += data;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: fullText } : m
                )
              );
              continue;
            }

            // Regular text token
            fullText += data;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: fullText } : m
              )
            );
          }
        }

        // Mark streaming complete
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, isStreaming: false } : m
          )
        );
        opts?.onDone?.();

        // Voice output (TTS)
        if (voiceEnabled && fullText && !fullText.startsWith("[TOOL:")) {
          try {
            // Strip tool JSON using brace-counting (handles nested objects)
            const cleanText = parseMessageContent(fullText)
              .filter((p) => p.type === "text")
              .map((p) => p.text || "")
              .join(" ")
              .replace(/\*\*/g, "")
              .trim();
            if (cleanText && "speechSynthesis" in window) {
              const utterance = new SpeechSynthesisUtterance(cleanText);
              utterance.rate = 1.0;
              utterance.pitch = 1.0;
              window.speechSynthesis.speak(utterance);
            }
          } catch {
            // TTS not critical
          }
        }
      } catch (err) {
        console.error("Chat error:", err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: "Connection lost. Tap to retry.", isStreaming: false }
              : m
          )
        );
        opts?.onDone?.();
      }

      setIsLoading(false);
    },
    [sessionId, isLoading, createSession, voiceEnabled]
  );

  // ── Keep sendMessageRef always pointing to the latest sendMessage ──────────
  sendMessageRef.current = sendMessage;

  // ── Read trip context once after mount ───────────────────────────────────
  useEffect(() => {
    setTripCtx(readTripContext());
  }, []);

  // ── Trigger governance hook ───────────────────────────────────────────────
  const hasRealItems = tripCtx.items?.some(
    (i) => i.price_estimate !== null && i.category !== 'note'
  ) ?? false;

  const atlasTrigger = useAtlasTrigger({
    tripId: tripCtx.tripId ?? null,
    destination: tripCtx.destination ?? null,
    hasItems: hasRealItems,
    isSurpriseMe: tripCtx.destination === 'Surprise Me',
    hasPriorMessages: messagesLenRef.current > 0,
  });

  // ── Consent effect: fire search only when user consents ──────────────────
  useEffect(() => {
    if (atlasTrigger.status !== 'consented') return;
    if (!tripCtx.destination || tripCtx.destination === 'your destination') return;

    const prompt = buildAutoSearchPrompt({
      destination: tripCtx.destination,
      dates: tripCtx.dates,
      flexibleWindow: tripCtx.flexibleWindow,
      tripLength: tripCtx.tripLength,
    });
    setIsOpen(true);
    atlasTrigger.markSearchStarted();
    sendMessageRef.current(prompt, { onDone: atlasTrigger.markSearchFinished });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlasTrigger.status]);

  // ── Guest save nudge — suggest registration after meaningful engagement ────

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("tpi_guest_nudge_shown")) return;

    const timer = setTimeout(async () => {
      const ctx = readTripContext();
      if (!ctx.isGuest || !ctx.tripId) return;
      if (sessionStorage.getItem("tpi_guest_nudge_shown")) return;

      // Fetch current item count from API (script tag is stale for new trips)
      try {
        const res = await fetch(`/api/trips/${ctx.tripId}/items`);
        if (!res.ok) return;
        const items = await res.json();
        if (!Array.isArray(items) || items.length < 3) return;
      } catch {
        return;
      }

      sessionStorage.setItem("tpi_guest_nudge_shown", "1");

      const nudgeId = msgIdCounter.current++;
      setMessages((prev) => [
        ...prev,
        {
          id: nudgeId,
          role: "assistant" as const,
          content: `I see you've put together a solid trip plan! Would you like to **save your itinerary** so you can access it later from any device?\n\n[Create a free account](/register?callbackUrl=/planner) — it takes 30 seconds, and all your trip data will be waiting for you.`,
        },
      ]);
      setIsOpen(true);
    }, 60_000);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── New chat ──────────────────────────────────────────────────────────────

  const handleNewChat = useCallback(async () => {
    setMessages([]);
    setError(null);
    sessionStorage.removeItem("atlas_session_id");
    setSessionId(null);
    await createSession();
  }, [createSession]);

  // ── Render ────────────────────────────────────────────────────────────────

  const showQuickActions = messages.length === 0 || (!isLoading && messages.length > 0);

  return (
    <>
      {/* Floating avatar + talk bubble */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-[90]">
          {/* Talk Bubble */}
          {currentBubble && assistantHealthy && (
            <div
              data-atlas-bubble
              onClick={() => { dismissBubble(); setIsOpen(true); }}
              className="absolute bottom-20 right-0 w-64 bg-white rounded-xl shadow-lg border border-gray-200 p-3 cursor-pointer hover:shadow-xl transition-shadow animate-bubble-pop"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm text-gray-700">{currentBubble.text}</p>
              {/* Speech bubble tail */}
              <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white border-r border-b border-gray-200 transform rotate-45" />
            </div>
          )}
          {/* Avatar button */}
          <button
            onClick={() => setIsOpen(true)}
            className="w-16 h-16 flex items-center justify-center animate-atlas-float"
            title="Ask Atlas"
          >
            <img src="/images/atlas-avatar.png" alt="Atlas" className="w-full h-full object-contain" />
          </button>
        </div>
      )}

      {/* Chat panel — sidebar or modal mode */}
      {isOpen && !isModalMode && (
        <div className="fixed bottom-0 right-0 z-[90] w-full sm:w-[400px] h-[calc(100vh-64px)] sm:h-[600px] sm:bottom-6 sm:right-6 flex flex-col bg-white sm:rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-orange-500 text-white">
            <div className="flex items-center gap-2">
              <img src="/images/atlas-avatar.png" alt="Atlas" className="w-7 h-7 rounded-full ring-1 ring-white/30" />
              <span className="font-semibold">{t("title")}</span>
            </div>
            <div className="flex items-center gap-1">
              {/* Voice toggle */}
              <button
                onClick={() => setVoiceEnabled(!voiceEnabled)}
                className={[
                  "p-1.5 rounded-full transition-colors",
                  voiceEnabled ? "bg-orange-400" : "hover:bg-orange-400/50",
                ].join(" ")}
                title={voiceEnabled ? "Mute Atlas voice" : "Enable Atlas voice"}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {voiceEnabled ? (
                    <>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </>
                  ) : (
                    <>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </>
                  )}
                </svg>
              </button>
              {/* New chat */}
              <button
                onClick={handleNewChat}
                className="p-1.5 rounded-full hover:bg-orange-400/50 transition-colors"
                title="New chat"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {/* Minimize */}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-full hover:bg-orange-400/50 transition-colors"
                title="Minimize"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center mt-8">
                <p className="text-4xl mb-3">{"\uD83E\uDDED"}</p>
                <p className="font-medium text-gray-700">Hi! I&apos;m Atlas</p>
                <p className="text-sm text-gray-500 mt-1">
                  Your AI travel concierge. Ask me about flights, hotels, destinations, or travel tips.
                </p>
              </div>
            )}

            {messages.map((msg) => {
              const parsed = msg.role === "assistant" ? parseMessageContent(msg.content) : [];
              // Gate on usable results, not tool count: empty/error flight searches cannot open a plan.
              const tripFlights = msg.role === "assistant" ? extractTripData(parsed).flights : [];
              const hasTripResults = tripFlights.length > 0;

              return (
                <div
                  key={msg.id}
                  className={msg.role === "user" ? "flex justify-end" : "flex justify-start items-start gap-2"}
                >
                  {msg.role === "assistant" && (
                    <img src="/images/atlas-avatar.png" alt="" className="w-6 h-6 rounded-full shrink-0 mt-1" />
                  )}
                  <div
                    className={[
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                      msg.role === "user"
                        ? "bg-orange-500 text-white rounded-br-md"
                        : "bg-gray-100 text-gray-800 rounded-bl-md",
                    ].join(" ")}
                  >
                    {msg.role === "assistant" ? (
                      <div>
                        {hasTripResults ? (
                          <>
                            {/* Show text summary only (strip tool JSON) */}
                            {(() => {
                              const summary = getTextSummary(parsed);
                              return summary ? (
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: renderMarkdownLite(summary),
                                  }}
                                />
                              ) : null;
                            })()}
                            {/* Render non-trip tool results inline as before */}
                            {parsed
                              .filter(
                                (p) =>
                                  p.type === "tool" &&
                                  p.toolName &&
                                  !TRIP_TOOLS.has(p.toolName) &&
                                  p.data
                              )
                              .map((part, i) => (
                                <ToolResultCards
                                  key={`nontool-${i}`}
                                  toolName={part.toolName!}
                                  data={part.data!}
                                />
                              ))}
                            {/* "View Full Plan" button — only when streaming is complete */}
                            {!msg.isStreaming && (
                              <button
                                onClick={() => {
                                  const ctx = readTripContext();
                                  setModalData({ flights: tripFlights, tripContext: ctx });
                                  setModalOpen(true);
                                }}
                                className="mt-3 w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors"
                              >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                  <line x1="3" y1="9" x2="21" y2="9" />
                                  <line x1="9" y1="21" x2="9" y2="9" />
                                </svg>
                                View Full Plan
                              </button>
                            )}
                          </>
                        ) : (
                          /* Standard rendering for messages without usable flight results */
                          parsed.map((part, i) => {
                            if (part.type === "tool" && part.toolName && part.data) {
                              return (
                                <ToolResultCards
                                  key={i}
                                  toolName={part.toolName}
                                  data={part.data}
                                />
                              );
                            }
                            return (
                              <span
                                key={i}
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownLite(part.text || ""),
                                }}
                              />
                            );
                          })
                        )}
                        {msg.isStreaming && (
                          <span className="inline-flex gap-1 ml-1">
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </span>
                        )}
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions */}
          {showQuickActions && (
            <div className="px-4 py-2 flex flex-wrap gap-2 border-t border-gray-100">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => sendMessage(action.message)}
                  disabled={isLoading}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-200 hover:border-orange-300 hover:bg-orange-50 text-gray-600 hover:text-orange-600 transition-colors disabled:opacity-50"
                >
                  {action.emoji} {action.label}
                </button>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100">
              {error}
            </div>
          )}

          {/* Input bar */}
          <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={t("placeholder")}
              disabled={isLoading}
              className="flex-1 text-sm px-3 py-2 rounded-full border border-gray-200 focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:opacity-50"
            />
            <VoiceInput
              onTranscription={(text) => {
                setInput((prev) => (prev ? prev + " " + text : text));
                inputRef.current?.focus();
              }}
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim()}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:hover:bg-orange-500 transition-colors"
              title="Send"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Chat Modal Mode — full-screen centered */}
      {isOpen && isModalMode && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[89] bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setIsModalMode(false);
              setIsOpen(false);
            }}
          />
          {/* Modal — Two-Panel: Chat + Sidebar */}
          <div className="fixed inset-2 z-[90] flex bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden max-h-[calc(100vh-16px)]">
            {/* Left Panel: Chat (fills remaining space) */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 bg-orange-500 text-white shrink-0">
              <div className="flex items-center gap-3">
                <img src="/images/atlas-avatar.png" alt="Atlas" className="w-8 h-8 rounded-full ring-1 ring-white/30" />
                <div>
                  <span className="font-semibold text-lg">{t("title")}</span>
                  <p className="text-xs text-orange-100">Your AI travel concierge</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Voice toggle */}
                <button
                  onClick={() => setVoiceEnabled(!voiceEnabled)}
                  className={[
                    "p-2 rounded-full transition-colors",
                    voiceEnabled ? "bg-orange-400" : "hover:bg-orange-400/50",
                  ].join(" ")}
                  title={voiceEnabled ? "Mute Atlas voice" : "Enable Atlas voice"}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {voiceEnabled ? (
                      <>
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </>
                    ) : (
                      <>
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </>
                    )}
                  </svg>
                </button>
                {/* New chat */}
                <button
                  onClick={handleNewChat}
                  className="p-2 rounded-full hover:bg-orange-400/50 transition-colors"
                  title="New chat"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                {/* Close */}
                <button
                  onClick={() => {
                    setIsModalMode(false);
                    setIsOpen(false);
                  }}
                  className="p-2 rounded-full hover:bg-orange-400/50 transition-colors"
                  title="Close"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 bg-gray-50">
              {messages.length === 0 && (
                <div className="text-center mt-16">
                  <p className="text-6xl mb-4">{"\uD83E\uDDED"}</p>
                  <p className="font-semibold text-gray-900 text-xl">Hi! I&apos;m Atlas</p>
                  <p className="text-gray-600 mt-2 max-w-sm mx-auto leading-relaxed">
                    Your AI travel concierge. Ask me about flights, hotels, destinations, or travel tips.
                  </p>
                </div>
              )}

              {messages.map((msg) => {
                const parsed = msg.role === "assistant" ? parseMessageContent(msg.content) : [];
                // Gate on usable results, not tool count: empty/error flight searches cannot open a plan.
                const tripFlights = msg.role === "assistant" ? extractTripData(parsed).flights : [];
                const hasTripResults = tripFlights.length > 0;

                return (
                  <div
                    key={msg.id}
                    className="flex justify-start items-start gap-3 w-full"
                  >
                    {msg.role === "assistant" && (
                      <img src="/images/atlas-avatar.png" alt="" className="w-8 h-8 rounded-full shrink-0 mt-1 ring-1 ring-orange-200" />
                    )}
                    <div
                      className={[
                        "rounded-2xl px-6 py-4 text-sm leading-relaxed w-full",
                        msg.role === "user"
                          ? "bg-orange-500 text-white rounded-lg mx-[5%]"
                          : "bg-white text-gray-900 rounded-bl-md shadow-sm border border-gray-200",
                      ].join(" ")}
                    >
                      {msg.role === "assistant" ? (
                        <div>
                          {hasTripResults ? (
                            <>
                              {(() => {
                                const summary = getTextSummary(parsed);
                                return summary ? (
                                  <span
                                    dangerouslySetInnerHTML={{
                                      __html: renderMarkdownLite(summary),
                                    }}
                                  />
                                ) : null;
                              })()}


                              {parsed
                                .filter(
                                  (p) =>
                                    p.type === "tool" &&
                                    p.toolName &&
                                    !TRIP_TOOLS.has(p.toolName) &&
                                    p.data
                                )
                                .map((part, i) => (
                                  <ToolResultCards
                                    key={`nontool-${i}`}
                                    toolName={part.toolName!}
                                    data={part.data!}
                                  />
                                ))}
                              {!msg.isStreaming && (
                                <button
                                  onClick={() => {
                                    const ctx = readTripContext();
                                    setModalData({ flights: tripFlights, tripContext: ctx });
                                    setModalOpen(true);
                                  }}
                                  className="mt-4 w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors"
                                >
                                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2" />
                                    <line x1="3" y1="9" x2="21" y2="9" />
                                    <line x1="9" y1="21" x2="9" y2="9" />
                                  </svg>
                                  View Full Plan
                                </button>
                              )}
                            </>
                          ) : (
                            parsed.map((part, i) => {
                              if (part.type === "tool" && part.toolName && part.data) {
                                return (
                                  <ToolResultCards
                                    key={i}
                                    toolName={part.toolName}
                                    data={part.data}
                                  />
                                );
                              }
                              return (
                                <span
                                  key={i}
                                  dangerouslySetInnerHTML={{
                                    __html: renderMarkdownLite(part.text || ""),
                                  }}
                                />
                              );
                            })
                          )}
                          {msg.isStreaming && (
                            <span className="inline-flex gap-1 ml-1">
                              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                            </span>
                          )}
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
              </div>

              {/* Error */}
              {error && (
                <div className="px-6 py-3 text-sm text-red-600 bg-red-50 border-t border-red-100 shrink-0">
                  {error}
                </div>
              )}

              {/* Input bar — always show */}
              <div className="px-6 py-4 border-t border-gray-200 flex items-center gap-3 shrink-0 bg-white">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={t("placeholder")}
                disabled={isLoading}
                className="flex-1 text-sm px-4 py-2.5 rounded-full border border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-400 outline-none disabled:opacity-50"
              />
              <VoiceInput
                onTranscription={(text) => {
                  setInput((prev) => (prev ? prev + " " + text : text));
                  inputRef.current?.focus();
                }}
                disabled={isLoading}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={isLoading || !input.trim()}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:hover:bg-orange-500 transition-colors"
                title="Send"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
              </div>
            </div>

            {/* Right Sidebar: Trip Cards */}
            <div className="w-96 border-l border-gray-200 overflow-y-auto bg-gray-50 p-5 flex flex-col gap-4 shrink-0">
              {(() => {
                let allTrips = { flights: [] as FlightResult[] };
                for (const msg of [...messages].reverse()) {
                  if (msg.role === "assistant") {
                    const parsed = parseMessageContent(msg.content);
                    const tripData = extractTripData(parsed);
                    if (tripData.flights.length > 0) {
                      allTrips = tripData;
                      break;
                    }
                  }
                }

                if (allTrips.flights.length === 0) {
                  return (
                    <div className="text-center text-gray-400 text-sm py-12">
                      <p className="text-3xl mb-3">📋</p>
                      <p>Trip details will appear here</p>
                    </div>
                  );
                }

                return (
                  <>
                    {allTrips.flights.length > 0 && (
                      <div>
                        <h3 className="font-bold text-gray-900 mb-3">✈️ Flights ({allTrips.flights.length})</h3>
                        <div className="space-y-2">
                          {allTrips.flights.map((f, i) => (
                            <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
                              <p className="font-bold text-orange-600 text-lg">{f.price}</p>
                              {f.airline && <p className="text-xs text-gray-600 font-medium">{f.airline}</p>}
                              <p className="text-xs text-gray-500 mt-1">{f.route}</p>
                              {f.nonstop && <span className="text-xs bg-green-100 text-green-700 rounded px-2 py-0.5 inline-block mt-1">Nonstop</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* Trip Results Modal */}
      {modalData && (
        <TripResultsModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          destination={modalData.tripContext.destination}
          dates={modalData.tripContext.dates}
          adults={modalData.tripContext.adults}
          flights={modalData.flights}
          budgetTier={modalData.tripContext.budgetTier}
          tripId={modalData.tripContext.tripId}
        />
      )}

      {/* Atlas smart search consent chip — portaled into the trip page slot */}
      {atlasTrigger.status === 'awaiting_consent' && assistantHealthy && tripCtx.destination && slot && createPortal(
        <AtlasSmartSearchChip
          destination={tripCtx.destination}
          onConsent={atlasTrigger.requestConsent}
          onDecline={atlasTrigger.declineConsent}
        />,
        slot
      )}
    </>
  );
}
