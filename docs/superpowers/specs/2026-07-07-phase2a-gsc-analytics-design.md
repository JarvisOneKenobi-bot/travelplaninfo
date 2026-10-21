# Phase 2A — GSC + Lightweight Analytics (Design)

**Date:** 2026-07-07
**Status:** Design derived from D10 + governance docs (Jose-approved direction). Implementation deferred — *banked* spec/plan pair. Can run alongside Phase 2/3 — but NOT in the same worktree as Phase 3, whose plan appends a `db.ts` migration at the same anchor and edits `AssistantChat.tsx` too; see the plan's Global Constraints for the rebase/re-read rule (review MEDIUM-5).
**Repo:** `travelplaninfo-prototype` (`main` @ `4d5a1e7`)
**Executes:** D10 ("stand up GSC + lightweight analytics now"). Governs to: `IMPLEMENTATION_PLAN.md:135-154`, `NORTH_STAR.md:54,85,87`, `SEO_MIGRATION_STRATEGY.md:116-124`, `VERIFICATION_CHECKLIST.md:190-205`.

---

## 1. Goal & success criteria

Stand up **Google Search Console verification** and a **cookieless, first-party, server-side lightweight analytics** layer that measures the guide→planner→Atlas→itinerary→affiliate funnel — with the **MVP metric = affiliate clicks per trip session** — without adding any third-party client script or cookie-consent burden.

**Success criteria** (from IMPLEMENTATION_PLAN:150-154):
1. GSC verified (or the blocker recorded); sitemap submission captured.
2. The 7 funnel events (§3.2) are captured server-side and queryable.
3. Affiliate-clicks-per-trip-session is queryable.
4. No user-visible regression; **no heavy/third-party client script** added.
5. Privacy page reconciled to accurately describe the analytics that now exists.
6. `npm run lint` / `test:unit` / `test:e2e` / `build` green.

---

## 2. Current state (ground truth, 2026-07-07 sweep)

- **Analytics: literally zero** — confirmed at source (no `gtag`/GA/Plausible/PostHog/`@vercel/analytics`/Mixpanel/Segment/Umami, no `next/script`, no custom `trackEvent`/beacon) *and* at the dependency layer. The only "analytics" is **prose in the privacy page that overstates reality**.
- **GSC:** no verification (no `google-site-verification` meta, no `public/` HTML file). **`src/app/sitemap.ts` (dynamic, locale-aware, article `alternates`) and `src/app/robots.ts` (disallows `/api/`, points to the sitemap) already exist** — only ownership verification is greenfield.
- **SQLite** (`src/lib/db.ts`, better-sqlite3, WAL, `data/tpi.db`): tables incl. `users` (guest_token), `trips` (entry_mode/status), `trip_items` (affiliate_program/affiliate_url/booked), `chat_sessions`/`chat_messages`, `assistant_cost`. **No `events` table; no `affiliate_click` table** (the latter is built in Phase 3).
- **Consent/privacy: none.** No cookie-consent component, no GDPR handling. `src/app/[locale]/privacy/page.tsx` exists but its §3 (lines 30,42-44) describes "analytics tools … cookies … opt out via your browser" — aspirational; no such system exists today.
- **Env:** `.env.local` + `.env.example`; no analytics var. `src/lib/server-config.ts` is a **server-secrets** centralizer (`import "server-only"`) — *not* the slot for a public GA id. Public client ids follow the `NEXT_PUBLIC_GOOGLE_MAPS_KEY` precedent (build-time inlined → rebuild+redeploy to change). A *server-side* ingestion token would belong in `server-config.ts`.
- **The real layout is `src/app/[locale]/layout.tsx`** (root `src/app/layout.tsx` just returns children; non-locale route files are stubs). Its `<head>` currently holds only JSON-LD; `metadata` is exported there.

---

## 3. Design

### 3.1 Analytics architecture — cookieless, first-party, server-side
No third-party script, no cookies. Add a general events table + one ingest route, reusing the existing `db.ts` pattern:
- **`events(id, event_type, trip_id, session_id, path, meta_json, created_at)`** in `data/tpi.db` (via `db.ts` `getDb()` migration).
- **`POST /api/event`** — best-effort ingest (a failed write never blocks UX). Validates `event_type` against the **client** allowlist (the 5 beacon events — server-only types like `trip_created` are rejected here, see below); guards `meta_json` **and `path`** heuristically against PII — rejects email-shaped values and long digit runs, clamps keys/types/sizes, and requires `path` to be a same-site pathname (free text within the caps that matches neither pattern inherently passes — a regex guard, not an absolute one). Rate-limited per IP (in-memory Map, ~60/min — the chat route's existing pattern); throttled beacons are dropped with 204, never an error. Disallowed by `robots.ts` already (`/api/`).
- **Client-only impressions** fire via a tiny `track(eventType, meta)` helper using `navigator.sendBeacon` (fallback `fetch(..., {keepalive:true})`) — no cookies, no fingerprinting; `session_id` is the server-resolved `users.id` (the guest row behind the existing httpOnly `tpi_guest` cookie, or the authed user's id — one uniform id space; the client never reads or sends any identifier).
- **Server-known events are captured server-side directly** (no beacon) at the API route that already handles them — cleaner and unspoofable: the public ingest's client allowlist rejects them, so they cannot be forged through `/api/event`.

### 3.2 The 7 funnel events (IMPLEMENTATION_PLAN:147) → capture site
| Event | Capture | Where |
|---|---|---|
| guide view | client beacon | `[locale]/[slug]`, `guides`, `destinations`, `hot-deals` pages |
| planner start | client beacon | `[locale]/planner` (PlannerDashboard) |
| trip created | **server-side only** | `POST /api/trips` (already writes `trips`); rejected at the public ingest — not client-postable |
| Atlas health hidden | client beacon | `AssistantChat` health-gate (`useAssistantHealth`) |
| Atlas consent | client beacon | `atlas-trigger-state` machine `→ consented` |
| tool result rendered | client beacon | `AssistantChat` card render |
| affiliate click | **server-side** | Phase 3's `POST /api/affiliate/click` → `affiliate_click` table |

### 3.3 Affiliate-click store — reuse Phase 3, standardize naming, join on `trip_id`
The MVP metric (affiliate-clicks-per-trip-session) reads **Phase 3's dedicated `affiliate_click` table** (`partner_id, trip_id, session_id, created_at`) — kept dedicated for clean querying, not merged into `events`. Phase 2A **consumes** it. **Join contract (review HIGH-3):** `trip_id` (`trips.id`, INTEGER — carried by both tables) is the ONLY cross-table join key. `session_id` has a DIFFERENT grain in each store by design — `events.session_id` = `users.id` (server-resolved), `affiliate_click.session_id` = Atlas `chat_sessions.id` (TEXT uuid, per the banked Phase 3 plan) — and is a within-table attribute only, never a join key. The MVP metric itself is an **aggregate ratio** (total clicks ÷ distinct trip-creating sessions) computed as two independent counts with no join; per-trip drill-down joins on `trip_id`. No Phase 3 code change is needed. **Naming reconcile:** standardize on `affiliate_click`; `VERIFICATION_CHECKLIST.md:195` uses the old `affiliate_click_events` name — update that doc line (O3).

### 3.4 GSC verification
- Add `verification: { google: process.env.GOOGLE_SITE_VERIFICATION }` to the exported `metadata` in `src/app/[locale]/layout.tsx` (Next metadata API renders the meta tag when the env var is set; renders nothing when absent — safe default).
- Token supplied by Jose from Search Console (O1). DNS-TXT is an equivalent no-code alternative if he prefers.
- `sitemap.ts` + `robots.ts` already correct → the only remaining GSC step is the **console-side** "add property + submit sitemap + request indexing" (a Jose action; captured as a task/blocker per acceptance).

### 3.5 Privacy-page reconciliation
Rewrite `src/app/[locale]/privacy/page.tsx` §3 to accurately describe **cookieless first-party analytics**: event-level records tied to a random session identifier (no names, no emails, no IPs, no fingerprints), **reported only in aggregate** — not "aggregate analytics", which would misstate the storage layer (review MEDIUM-3). The copy must also disclose the functional cookies that DO exist: the 7-day `tpi_guest`+`tpi_guest_hint` guest **pair** (not a singular session cookie), next-intl's `NEXT_LOCALE` language-preference cookie, and auth cookies. Because the *analytics* is cookieless, **no EU consent banner is required** — which is why we avoid a cookie-based tag (GA) that *would* require building the currently-absent banner.

### 3.6 Reporting (MVP)
No dashboard UI now. Provide the queryable layer: a small internal `/api/analytics/summary` (or documented SQL) that returns funnel counts + affiliate-clicks-per-trip-session. A self-hosted **Plausible/Umami** visual dashboard on the VPS stays an **approval-gated later** option (O2) — both cookieless/GDPR-friendly, but each adds a client script, which acceptance :154 says needs approval.

---

## 4. Task breakdown
1. `events` table + `db.ts` migration (idempotent CREATE).
2. `POST /api/event` ingest (client allowlist + PII guard on `meta`/`path` + per-IP rate limit + best-effort).
3. Client `track()` helper (`sendBeacon`), wire the 5 client-only events (§3.2).
4. Server-side capture for `trip created` at `POST /api/trips` (piggyback existing write).
5. GSC meta-tag mechanism (env-driven `metadata.verification.google`) + confirm sitemap/robots; record the console submission task.
6. Privacy-page reconciliation (§3.5).
7. Reporting layer — `/api/analytics/summary` or documented queries; prove affiliate-clicks-per-trip-session + funnel are queryable.
8. Verify: events land on real actions; GSC tag renders with a token; **no third-party request / no console error** on the client; lint/unit/e2e/build green.

---

## 5. Out of scope / dependencies
- **Visual dashboard** (Plausible/Umami) — approval-gated later (O2).
- **The `affiliate_click` table itself** — built by Phase 3; Phase 2A consumes it. Phase 2A's *affiliate-click event* is therefore soft-gated on Phase 3's `/api/affiliate/click` existing (the other 6 events + GSC are independent and can ship first).
- Cross-device identity resolution beyond session/trip id.

---

## 6. Verification bar
- A real guide view / planner start / consent / tool-render produces an `events` row; a real trip POST + affiliate click are queryable per trip session. `atlas_health_hidden` (the 5th client event) is verified by unit test (+ an optional stopped-endpoint smoke) — it cannot co-occur with a healthy consent flow in a single live pass.
- GSC meta tag renders iff `GOOGLE_SITE_VERIFICATION` is set (and nothing when unset).
- Privacy page matches reality; no cookie set for analytics; **no third-party network request** from the client.
- `npm run lint`/`test:unit`/`test:e2e`/`build` green. VPS deploy STOP-gate before prod.

---

## 7. Open questions
- **O1 (GSC token):** Jose supplies the Search Console verification token (or does DNS-TXT). Non-blocking — the env-driven meta renders nothing until set.
- **O2 (dashboard):** self-hosted Plausible/Umami on the VPS — defer; needs Jose's approval (adds a client script per acceptance :154).
- **O3 (naming):** standardize `affiliate_click`; update `VERIFICATION_CHECKLIST.md:195` (`affiliate_click_events`).

---

## 8. References
- `docs/DECISIONS.md:22` (D10). `docs/product/IMPLEMENTATION_PLAN.md:135-154` (Phase 2A, event list, acceptance).
- `docs/product/NORTH_STAR.md:54,85,87`; `SEO_MIGRATION_STRATEGY.md:116-124`; `VERIFICATION_CHECKLIST.md:190-205`.
- Phase 3 spec `2026-07-07-phase3-monetization-loop-design.md` (`affiliate_click` overlap, §3.4).
