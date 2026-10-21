# Phase 3 — Truthful Planner Monetization Loop Implementation Plan

> **For agentic workers:** This plan is executed task-by-task by GPT-5.5 dispatched via the Hermes CLI (`hermes -z "<prompt>" -m gpt-5.5 --cli --yolo`), one task per dispatch, orchestrated by an Opus 4.8 agent, from a fresh context with no memory of prior conversation. Read the entire task you are assigned before starting. Do not skip verification steps. If a verification command fails, stop and report — do not guess a fix that isn't in this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the guide → planner → Atlas → itinerary → affiliate-click loop truthful (D3: zero fabricated hotel/activity/restaurant names, ratings, or prices on any surface) and measurable (server-side click counting keyed by partner + trip/session), governed by one affiliate source of truth (D7) with correct `rel="sponsored"` disclosure. Spec: `docs/superpowers/specs/2026-07-07-phase3-monetization-loop-design.md`.

**Click-metric scope (review MEDIUM-1):** server-side counting covers the `AffiliateLink`-rendered Atlas-loop surfaces — atlas `FlightCard`/`DealCard`, the `TripResultsModal` flights tab, the two destinations-page flight CTAs, and `PartnerHandoffCard`. Every other compliant affiliate surface (the TripModes CJ cruise links, destinations hotel/car anchors, the planner sidebar, `hot-deals`, banners, inline non-trailing prose links) is rel-only in this phase and does NOT log clicks; middle-click/context-menu opens bypass `onClick` even on migrated anchors. The count is a floor, not a census.

**O4 definition of done (review HIGH-2):** Tiqets/Kiwi.com/Kiwitaxi ship **registered-but-disabled** (`enabled:false`, `buildUrl → ""`) and that counts as done for this phase; making their links live is the tracked O4 follow-up — resolvable in-session via the optional Task 4b (TP API fetch, main session) or later by Jose (Travelpayouts dashboard).

**Architecture:** Additive, not a rewrite. A typed `PARTNERS` registry layers on top of the existing `CJ_LINKS`/`TP_*` builders in `src/config/affiliates.ts` (which keep working untouched). A single client-side choke point (`logAffiliateClick`/`openAffiliate` + the `<AffiliateLink>` component) sets `rel`, `target`, and fire-and-forget click logging once, and high-value render sites migrate onto it. Clicks land in a new `affiliate_click` SQLite table via `POST /api/affiliate/click`. The dead fabricated-inventory paths (AssistantChat normalization/cards, `TripResultsModal` hotel/activity/restaurant tabs, the fabricated result types) are deleted under an extended `no-fabrication` test guard, and the prose partner-handoff link Atlas already emits is promoted into a styled `PartnerHandoffCard`. AirAdvisor is flagged off until an earning CJ URL exists.

**Tech Stack:** Next.js 16 / TypeScript / React 19, `better-sqlite3` (via `src/lib/db.ts`), Vitest (jsdom + `@testing-library/react`, already in devDependencies), Playwright.

## Global Constraints

- **Hard precondition:** Phase 2 (Atlas brain relocation, merged at `main`/`4d5a1e7`) must be **deployed and live on the VPS** before Task 11's live smoke. Implementation tasks 1–10 may run beforehand in the worktree, but the branch does not merge or deploy until Phase 2 is live.
- **Worktree:** `/home/jarvis/.openclaw/workspace/jarvis-project/tpi-phase3-monetization`, branch `feat/phase3-monetization-loop`, cut from `main` @ `4d5a1e7` (create via `superpowers:using-git-worktrees` at execution time). All paths below are relative to that root. If the spec (`docs/superpowers/specs/2026-07-07-phase3-monetization-loop-design.md`) and this plan are untracked in the worktree, commit them first: `git add docs/superpowers && git commit -m "docs: bank Phase 3 monetization spec + plan"`.
- **Test command:** `npm run test` runs unit + e2e. For a single file ALWAYS use `npm run test:unit -- <path>` (the `test:unit` script is `vitest run`). NEVER `npm run test -- <path>` — the extra arg is forwarded to the e2e runner.
- **Dependencies:** if `node_modules` is absent in the worktree, run `npm ci` once before any test step.
- **E2E:** the Playwright suite expects a server already running at `http://localhost:3001` (`playwright.config.ts` `baseURL`) — executors never run `npm run test` or `npm run test:e2e`. The executor branch gate is `npm run lint && npm run test:unit && npm run build` (Task 10). E2E + live smoke run in the main session (Task 11).
- **Affiliate tracking rules (NON-NEGOTIABLE, from MEMORY + spec §8):** Travelpayouts marker is `164743`; TPI's traffic-source id (`trs`) is `500721`; Klook's confirmed ids are `campaign_id=137`, `p=4110`. **NEVER** build a link with `p=4001` (unsubscribed Booking.com campaign — 400s at click time). **NEVER** append query params to a `tpx.li` short link. **NEVER invent** a Travelpayouts `campaign_id`/`p` pair — Tiqets/Kiwi.com/Kiwitaxi ids are not in this repo and stay `null`/`enabled:false` until real ids exist: supplied by Jose, or fetched from the TP API by the MAIN session (Task 4; optional Task 4b).
- **`rel` policy:** every affiliate anchor renders the three tokens `sponsored noopener noreferrer` (assert token presence, not string order — the codebase already contains both orders). Non-affiliate links (Google Maps, internal, Jose's own transport sites) never gain `sponsored`.
- **Line numbers** cited below are as of `main` @ `4d5a1e7` and drift as tasks land. Always locate the quoted anchor text with grep before editing; the anchor text is authoritative, the line number is a hint.
- **Cross-phase `db.ts` anchor (shared with Phase 2A — its review MEDIUM-5, 2026-07-07):** this plan and `2026-07-07-phase2a-gsc-analytics.md` both append an idempotent `CREATE TABLE IF NOT EXISTS` migration directly after the `assistant_cost` block, and both edit `AssistantChat.tsx`. NEVER run the two plans in the same worktree. If Phase 2A lands first (or vice versa), rebase before executing: whichever plan executes second MUST re-read the then-current `src/lib/db.ts` and insert after the **newest** migration block (the anchor is the quoted text, not a hardcoded line) — merge order is irrelevant because both migrations are idempotent; the two plans' `AssistantChat.tsx` edit sites do not overlap.
- **TDD:** write the failing test first, watch it fail, implement, watch it pass, commit. One commit per task.
- **Do not touch:** `command-post/` Python code; `content/articles/*` JSON (article prose mentioning Tiqets/Kiwi is content, not config); locale message files under `messages/` (removed help/recommendation strings may leave unused keys — that is fine); the already-compliant affiliate surfaces (`hot-deals/page.tsx`, `AffiliateSidebar.tsx`, `ArticleAffiliateCTA.tsx`, `AffiliateInlineCTA.tsx`, `PackageDealsCarousel.tsx`, `DesignA.tsx`, `ItineraryBuilder.tsx:624`, `AffiliatePreviewModal.tsx`); the dormant orphans `src/components/TransferCard.tsx`, `src/components/CarRentalCard.tsx`, `src/components/ActivityCard.tsx` (non-atlas — spec §5 leaves them for a later dead-code pass); the Atlas brain (`src/lib/atlas/tool-loop.ts`, `travelpayouts-client.ts`) except the single system-prompt line named in Task 9.

---

### Task 1: `affiliate_click` table + `recordAffiliateClick`

**Files:**
- Modify: `src/lib/db.ts` (add one migration block after the `assistant_cost` block that ends near line 130)
- Create: `src/lib/affiliate-clicks.ts`
- Test: `src/lib/affiliate-clicks.test.ts`

**Interfaces:**
- Produces: `recordAffiliateClick(record: { partnerId: string; tripId?: number | null; sessionId?: string | null }): void` — inserts one row into `affiliate_click`. `trip_id` is a TPI `trips.id` (INTEGER); `session_id` is an Atlas `chat_sessions.id` (TEXT uuid). Both nullable — a guest click on a static page logs partner-only.
- Produces (schema): table `affiliate_click(id, partner_id, trip_id, session_id, created_at)` — exactly the spec §3.4 shape. Phase 2A analytics will read this table later; do not add extra columns.
- **Cross-plan join contract (Phase 2A review HIGH-3, 2026-07-07):** Phase 2A's MVP metric joins this table to its `events` table on **`trip_id` only**; `session_id` grains intentionally differ (`chat_sessions.id` uuid here vs `users.id` in `events`) and `session_id` is never a cross-table join key — no code change in this plan.

**Test isolation warning:** `DB_PATH` in `src/lib/db.ts:6` is the real `data/tpi.db`. Follow the existing convention in `src/lib/atlas/spend.test.ts` exactly: mock `@/lib/db` with an in-memory `better-sqlite3` database and create the table inline in `beforeEach`. Never touch the real file from a unit test.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/affiliate-clicks.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// In-memory DB — never touches the real data/tpi.db. Mirrors the
// affiliate_click schema added to src/lib/db.ts in this task.
let memDb: Database.Database;
vi.mock("@/lib/db", () => ({
  getDb: () => memDb,
}));

import { recordAffiliateClick } from "./affiliate-clicks";

describe("affiliate click recording", () => {
  beforeEach(() => {
    memDb = new Database(":memory:");
    memDb.exec(`
      CREATE TABLE affiliate_click (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_id TEXT NOT NULL,
        trip_id    INTEGER,
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  it("inserts one row keyed by partner + trip + session", () => {
    recordAffiliateClick({ partnerId: "hotels_cj", tripId: 42, sessionId: "abc-123" });
    const rows = memDb
      .prepare("SELECT partner_id, trip_id, session_id FROM affiliate_click")
      .all();
    expect(rows).toEqual([{ partner_id: "hotels_cj", trip_id: 42, session_id: "abc-123" }]);
  });

  it("stores NULL attribution when trip/session are unknown (guest on a static page)", () => {
    recordAffiliateClick({ partnerId: "aviasales" });
    const row = memDb
      .prepare("SELECT partner_id, trip_id, session_id FROM affiliate_click")
      .get() as { partner_id: string; trip_id: number | null; session_id: string | null };
    expect(row.partner_id).toBe("aviasales");
    expect(row.trip_id).toBeNull();
    expect(row.session_id).toBeNull();
  });

  it("accumulates multiple clicks as separate rows (server-side counting)", () => {
    recordAffiliateClick({ partnerId: "klook", tripId: 7, sessionId: "s-1" });
    recordAffiliateClick({ partnerId: "klook", tripId: 7, sessionId: "s-1" });
    const count = memDb.prepare("SELECT COUNT(*) AS n FROM affiliate_click").get() as { n: number };
    expect(count.n).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/affiliate-clicks.test.ts`
Expected: FAIL — module `./affiliate-clicks` does not exist.

- [ ] **Step 3: Implement**

In `src/lib/db.ts`, directly after the existing block that ends with

```typescript
    CREATE INDEX IF NOT EXISTS idx_assistant_cost_date ON assistant_cost(date);
  `);
```

insert (matching the file's migration-block style):

```typescript
  // Migration: affiliate click tracking (Phase 3) — server-side click counting
  _db.exec(`
    CREATE TABLE IF NOT EXISTS affiliate_click (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id TEXT NOT NULL,
      trip_id    INTEGER,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_affiliate_click_partner ON affiliate_click(partner_id);
    CREATE INDEX IF NOT EXISTS idx_affiliate_click_created ON affiliate_click(created_at);
  `);
```

Create `src/lib/affiliate-clicks.ts`:

```typescript
// Server-side affiliate click counting (spec §3.4). One row per outbound
// affiliate click, keyed by partner + trip/session. Consumed later by the
// Phase 2A analytics dashboard — keep the shape stable.
import { getDb } from "@/lib/db";

export interface AffiliateClickRecord {
  partnerId: string;
  tripId?: number | null;
  sessionId?: string | null;
}

export function recordAffiliateClick(record: AffiliateClickRecord): void {
  getDb()
    .prepare(
      `INSERT INTO affiliate_click (partner_id, trip_id, session_id)
       VALUES (@partnerId, @tripId, @sessionId)`
    )
    .run({
      partnerId: record.partnerId,
      tripId: record.tripId ?? null,
      sessionId: record.sessionId ?? null,
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/affiliate-clicks.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/affiliate-clicks.ts src/lib/affiliate-clicks.test.ts
git commit -m "feat(monetization): add affiliate_click table and server-side click recorder"
```

---

### Task 2: `PARTNERS` registry + `isAffiliateHost` (D7 single source of truth)

**Files:**
- Modify: `src/config/affiliates.ts` (215 lines — append the new section immediately BEFORE the final `export default CJ_LINKS;` line)
- Test: `src/config/affiliates.test.ts` (new)

**Interfaces:**
- Produces: `type PartnerId = "hotels_cj" | "vrbo_cj" | "cruisedirect_cj" | "economybookings_cj" | "airadvisor_cj" | "aviasales" | "klook"` (Task 4 extends this union with `"tiqets" | "kiwi" | "kiwitaxi"`).
- Produces: `interface Partner { id: PartnerId; network: "cj" | "travelpayouts"; label: string; embedMode: "newtab" | "iframe"; rel: "sponsored"; enabled: boolean; hosts: string[]; buildUrl: (params?: Record<string, string>) => string }`.
- Produces: `PARTNERS: Record<PartnerId, Partner>` and `isAffiliateHost(url: string): boolean`.
- The existing `CJ_LINKS`, `TP_CONFIG`, `TP_KLOOK`, `DEALS`, `CJ_BANNERS`, `getAffiliateUrl` exports are NOT modified — the registry wraps them (additive, spec §3).
- A `buildUrl` that returns `""` means "no earning URL can be built" — consumers (Task 3) render nothing / no-op in that case.

- [ ] **Step 1: Write the failing test**

```typescript
// src/config/affiliates.test.ts
import { describe, it, expect } from "vitest";
import { PARTNERS, isAffiliateHost, CJ_LINKS, TP_CONFIG } from "./affiliates";

describe("PARTNERS registry (D7)", () => {
  it("contains the CJ set + Aviasales + Klook", () => {
    expect(Object.keys(PARTNERS)).toEqual(
      expect.arrayContaining([
        "hotels_cj",
        "vrbo_cj",
        "cruisedirect_cj",
        "economybookings_cj",
        "airadvisor_cj",
        "aviasales",
        "klook",
      ])
    );
  });

  it("every partner is newtab + sponsored (H6: embedMode is metadata only today)", () => {
    for (const partner of Object.values(PARTNERS)) {
      expect(partner.embedMode).toBe("newtab");
      expect(partner.rel).toBe("sponsored");
    }
  });

  it("hotels_cj wraps the existing CJ builders (city deep link + evergreen fallback)", () => {
    expect(PARTNERS.hotels_cj.buildUrl({ city: "Miami" })).toBe(CJ_LINKS.hotelsCity("Miami"));
    expect(PARTNERS.hotels_cj.buildUrl()).toBe(CJ_LINKS.hotels());
  });

  it("klook builds the confirmed tp.media link (campaign 137 / p 4110 / trs 500721 / marker 164743)", () => {
    const url = PARTNERS.klook.buildUrl({ city: "Miami" });
    expect(url).toContain("tp.media/r");
    expect(url).toContain("campaign_id=137");
    expect(url).toContain("p=4110");
    expect(url).toContain("trs=500721");
    expect(url).toContain(`marker=${TP_CONFIG.marker}`);
  });

  it("aviasales builds marker links with and without a route", () => {
    expect(PARTNERS.aviasales.buildUrl({ origin: "MIA", destination: "CUN" })).toBe(
      TP_CONFIG.searchUrl("MIA", "CUN")
    );
    expect(PARTNERS.aviasales.buildUrl()).toContain("marker=164743");
  });

  it("airadvisor is disabled and never routes to the raw non-earning site URL (O1)", () => {
    expect(PARTNERS.airadvisor_cj.enabled).toBe(false);
    expect(PARTNERS.airadvisor_cj.buildUrl()).toBe("");
  });
});

describe("isAffiliateHost (spec §3.5 host allowlist)", () => {
  it("classifies affiliate hosts, including subdomains", () => {
    expect(isAffiliateHost("https://www.dpbolvw.net/click-101692716-15734399?sid=travelplaninfo")).toBe(true);
    expect(isAffiliateHost("https://tp.media/r?campaign_id=137&marker=164743&p=4110&trs=500721&u=x")).toBe(true);
    expect(isAffiliateHost("https://www.aviasales.com/?marker=164743")).toBe(true);
    expect(isAffiliateHost("https://www.jdoqocy.com/click-101692716-10784831")).toBe(true);
  });

  it("never classifies non-affiliate links (so we never mislabel them sponsored)", () => {
    expect(isAffiliateHost("https://www.google.com/maps/search/restaurants+in+Miami")).toBe(false);
    expect(isAffiliateHost("https://travelplaninfo.com/guides")).toBe(false);
    expect(isAffiliateHost("/miami-guide")).toBe(false);
    expect(isAffiliateHost("https://airadvisor.com/en/flight-compensation")).toBe(false);
    expect(isAffiliateHost("https://airportspickup.com/")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/config/affiliates.test.ts`
Expected: FAIL — `PARTNERS` / `isAffiliateHost` not exported.

- [ ] **Step 3: Implement**

In `src/config/affiliates.ts`, insert immediately BEFORE the final line `export default CJ_LINKS;`:

```typescript
// ── D7 partner registry — the single affiliate source of truth ──────────────
// Additive layer over the CJ_LINKS/TP_* builders above (which keep working).
// Every affiliate render site resolves partners through this registry so rel,
// tracking, and enable/disable live in ONE place. Task 4 adds Tiqets / Kiwi.com
// / Kiwitaxi; their Travelpayouts ids are pending confirmation.

export type PartnerNetwork = "cj" | "travelpayouts";
// H6: embedMode is capability metadata. Every current partner blocks iframing
// (X-Frame-Options/CSP), so all entries are "newtab" and NO iframe path is
// built. A future embeddable-widget partner flips one field, not a refactor.
export type PartnerEmbedMode = "newtab" | "iframe";

export type PartnerId =
  | "hotels_cj"
  | "vrbo_cj"
  | "cruisedirect_cj"
  | "economybookings_cj"
  | "airadvisor_cj"
  | "aviasales"
  | "klook";

export interface Partner {
  id: PartnerId;
  network: PartnerNetwork;
  label: string;
  embedMode: PartnerEmbedMode;
  rel: "sponsored"; // affiliate anchors always render "sponsored noopener noreferrer"
  enabled: boolean;
  /** Hostnames for isAffiliateHost() CLASSIFICATION ONLY — not ownership: CJ
   * domains are shared across programs (dpbolvw.net serves Hotels.com AND
   * CruiseDirect deep links; jdoqocy.com serves Vrbo AND EconomyBookings).
   * NEVER reverse-map a host back to a partner for attribution. */
  hosts: string[];
  /** Wraps the existing builders. Returns "" when no earning URL can be built. */
  buildUrl: (params?: Record<string, string>) => string;
}

export const PARTNERS: Record<PartnerId, Partner> = {
  hotels_cj: {
    id: "hotels_cj",
    network: "cj",
    label: "Hotels.com",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: true,
    hosts: ["dpbolvw.net", "hotels.com"],
    buildUrl: (params) => (params?.city ? CJ_LINKS.hotelsCity(params.city) : CJ_LINKS.hotels()),
  },
  vrbo_cj: {
    id: "vrbo_cj",
    network: "cj",
    label: "Vrbo",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: true,
    hosts: ["jdoqocy.com", "vrbo.com"],
    buildUrl: () => CJ_LINKS.vrbo(),
  },
  cruisedirect_cj: {
    id: "cruisedirect_cj",
    network: "cj",
    label: "CruiseDirect",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: true,
    hosts: ["tkqlhce.com", "anrdoezrs.net", "kqzyfj.com", "cruisedirect.com"],
    buildUrl: () => CJ_LINKS.cruises(),
  },
  economybookings_cj: {
    id: "economybookings_cj",
    network: "cj",
    label: "EconomyBookings",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: true,
    hosts: ["economybookings.com"],
    buildUrl: () => CJ_LINKS.cars(),
  },
  airadvisor_cj: {
    // O1: CJ program status "New" — no earning click URL exists yet. Disabled
    // until Jose supplies the approved CJ tracking URL. hosts stays empty on
    // purpose: the raw airadvisor.com site URL is NOT an affiliate link and
    // must never be classified (or rel="sponsored"-labeled) as one.
    id: "airadvisor_cj",
    network: "cj",
    label: "AirAdvisor",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: false,
    hosts: [],
    buildUrl: () => "",
  },
  aviasales: {
    id: "aviasales",
    network: "travelpayouts",
    label: "Aviasales",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: true,
    hosts: ["aviasales.com"],
    buildUrl: (params) =>
      params?.origin && params?.destination
        ? TP_CONFIG.searchUrl(params.origin, params.destination)
        : `https://www.aviasales.com/?marker=${TP_CONFIG.marker}`,
  },
  klook: {
    id: "klook",
    network: "travelpayouts",
    label: "Klook",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: true,
    hosts: ["tp.media", "klook.com"],
    buildUrl: (params) => TP_KLOOK.url(params?.city ?? ""),
  },
};

// Host-allowlist classifier for prose/static links (spec §3.5): links on these
// hosts get rel="sponsored noopener noreferrer"; everything else keeps plain
// "noopener noreferrer". Allowlist, not blanket — never mislabel non-affiliate
// links (Google Maps, internal pages, Jose's own transport sites).
export function isAffiliateHost(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // relative/internal URLs are never affiliate
  }
  for (const partner of Object.values(PARTNERS)) {
    for (const host of partner.hosts) {
      if (hostname === host || hostname.endsWith(`.${host}`)) return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- src/config/affiliates.test.ts`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add src/config/affiliates.ts src/config/affiliates.test.ts
git commit -m "feat(monetization): add D7 PARTNERS registry and isAffiliateHost classifier"
```

---

### Task 3: `logAffiliateClick`/`openAffiliate` + `<AffiliateLink>` + `POST /api/affiliate/click`

**Files:**
- Create: `src/lib/affiliate-opener.ts`
- Create: `src/components/AffiliateLink.tsx`
- Create: `src/app/api/affiliate/click/route.ts`
- Modify: `tsconfig.json` (ONE line: `lib` `"ES2020"` → `"ES2022"` — required by `Object.hasOwn` in the route; typecheck-only, see Step 3)
- Test: `src/components/AffiliateLink.test.tsx` (first `.test.tsx` in the repo — `vitest.config.ts` already runs jsdom + `@vitejs/plugin-react` and includes `src/**/*.test.{ts,tsx}`, and `@testing-library/react` is already a devDependency), `src/lib/affiliate-opener.test.ts`, `src/app/api/affiliate/click/route.test.ts`

**Interfaces:**
- Consumes: `PARTNERS`/`PartnerId` from Task 2; `recordAffiliateClick` from Task 1 (route side).
- Produces: `logAffiliateClick(partnerId: PartnerId, ctx?: { tripId?: number | null; sessionId?: string | null }): void` — fire-and-forget beacon to `/api/affiliate/click`; **never throws, never blocks navigation** (spec §3.4). When `ctx` omits ids it falls back to the DOM: `sessionStorage["atlas_session_id"]` (the `chat_sessions.id` AssistantChat stores at `AssistantChat.tsx:559`) and the `#atlas-trip-context` script tag's `tripId` — this resolves spec open question O3 with one shared mechanism for every surface.
- Produces: `openAffiliate(partnerId, opts?: { params?: Record<string,string>; href?: string; tripId?; sessionId? }): void` — resolves the partner, logs, then `window.open(url, "_blank", "noopener,noreferrer")` (embedMode `newtab`; no iframe path exists — H6). No Phase-3 render site calls it (every migration uses `<AffiliateLink>`); it ships unit-tested (disabled no-op; logs-once-then-opens) so the spec §3.2 programmatic contract is pinned, not dead weight (review MEDIUM-2).
- Produces: `<AffiliateLink partnerId href? params? tripId? sessionId? className>` — renders `<a target="_blank" rel="sponsored noopener noreferrer" onClick={log}>`. `href` (a pre-built affiliate URL, e.g. a tool-returned `book_url`) wins over `buildUrl(params)`. Renders `null` for a disabled partner or an empty URL. Tasks 6 and 8 consume this component.
- Produces: `POST /api/affiliate/click` accepting `{"partner_id": string, "trip_id"?: number, "session_id"?: string}`; 400 on bad JSON, on unknown partner (`Object.hasOwn` against `PARTNERS` — NEVER the `in` operator, which walks the prototype chain and would accept `"toString"`/`"constructor"`), and on **disabled** partners (no UI surface can render one, so such clicks are synthetic by definition); `{ ok: true }` on insert. Writes are rate-limited per IP (in-memory map, 30/min — the `src/app/api/assistant/chat/route.ts` pattern, keyed by the first `x-forwarded-for` hop); a throttled request answers `{ ok: true }` WITHOUT inserting, so beacons never break (review HIGH-1). Unauthenticated by design — guest clicks must count; metric integrity comes from registry validation + the rate limit. (A soft same-origin `Origin`/`Referer` check was reviewed as optional and is deliberately not built — revisit in Phase 2A if bot noise appears.)

- [ ] **Step 1: Write the failing tests (three files)**

```tsx
// src/components/AffiliateLink.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AffiliateLink from "./AffiliateLink";

const sendBeacon = vi.fn(() => true);

describe("AffiliateLink", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sendBeacon.mockClear();
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    sessionStorage.clear();
    document.getElementById("atlas-trip-context")?.remove();
  });

  it("renders sponsored + noopener + noreferrer and a new-tab target", () => {
    render(
      <AffiliateLink partnerId="hotels_cj" params={{ city: "Miami" }}>
        Search hotels
      </AffiliateLink>
    );
    const link = screen.getByRole("link", { name: "Search hotels" });
    const rel = (link.getAttribute("rel") || "").split(/\s+/);
    expect(rel).toEqual(expect.arrayContaining(["sponsored", "noopener", "noreferrer"]));
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("href")).toContain("dpbolvw.net");
  });

  it("prefers a pre-built href (tool-returned URLs) over buildUrl", () => {
    render(
      <AffiliateLink partnerId="aviasales" href="https://www.aviasales.com/search/MIA0109CUN1?marker=164743">
        Book
      </AffiliateLink>
    );
    expect(screen.getByRole("link", { name: "Book" }).getAttribute("href")).toBe(
      "https://www.aviasales.com/search/MIA0109CUN1?marker=164743"
    );
  });

  it("fires exactly one click beacon to /api/affiliate/click", () => {
    render(
      <AffiliateLink partnerId="hotels_cj" params={{ city: "Miami" }} tripId={7} sessionId="s-1">
        Go
      </AffiliateLink>
    );
    fireEvent.click(screen.getByRole("link", { name: "Go" }));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe("/api/affiliate/click");
    expect(sendBeacon.mock.calls[0][1]).toBeInstanceOf(Blob);
  });

  // review MEDIUM-3: the O3 fallback tests assert the PAYLOAD, not just that a
  // beacon fired. Removing sendBeacon forces logAffiliateClick's fetch fallback,
  // whose JSON body is a plain string we can parse — no Blob API needed.
  it("falls back to sessionStorage atlas_session_id for attribution (O3) — payload asserted", () => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
    const fetchMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem("atlas_session_id", "sess-from-storage");
    render(
      <AffiliateLink partnerId="klook" params={{ city: "Miami" }}>
        Tours
      </AffiliateLink>
    );
    fireEvent.click(screen.getByRole("link", { name: "Tours" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/affiliate/click");
    expect(JSON.parse(init.body)).toMatchObject({
      partner_id: "klook",
      session_id: "sess-from-storage",
    });
  });

  it("falls back to the #atlas-trip-context script tag for trip attribution (O3)", () => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
    const fetchMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", fetchMock);
    const script = document.createElement("script");
    script.id = "atlas-trip-context";
    script.type = "application/json";
    script.textContent = JSON.stringify({ tripId: 42 });
    document.body.appendChild(script);
    render(
      <AffiliateLink partnerId="hotels_cj" params={{ city: "Miami" }}>
        Hotels
      </AffiliateLink>
    );
    fireEvent.click(screen.getByRole("link", { name: "Hotels" }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).trip_id).toBe(42);
  });

  it("renders nothing for a disabled partner (AirAdvisor)", () => {
    const { container } = render(<AffiliateLink partnerId="airadvisor_cj">Claim</AffiliateLink>);
    expect(container.innerHTML).toBe("");
  });
});
```

```typescript
// src/lib/affiliate-opener.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openAffiliate } from "./affiliate-opener";

// review MEDIUM-2: openAffiliate has no render-path caller in this phase, so
// these tests pin its spec §3.2 contract directly.
const sendBeacon = vi.fn(() => true);
const windowOpen = vi.fn(() => null);

describe("openAffiliate", () => {
  beforeEach(() => {
    sendBeacon.mockClear();
    windowOpen.mockClear();
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    vi.stubGlobal("open", windowOpen); // jsdom: window IS the global, so window.open is stubbed
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op for a disabled partner — no log, no navigation", () => {
    openAffiliate("airadvisor_cj");
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("logs exactly once, then opens the URL in a new tab with noopener,noreferrer", () => {
    openAffiliate("hotels_cj", { params: { city: "Miami" }, tripId: 7, sessionId: "s-1" });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe("/api/affiliate/click");
    expect(windowOpen).toHaveBeenCalledTimes(1);
    const [url, target, features] = windowOpen.mock.calls[0] as unknown as [string, string, string];
    expect(url).toContain("dpbolvw.net");
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    // log-before-open ordering
    expect(sendBeacon.mock.invocationCallOrder[0]).toBeLessThan(windowOpen.mock.invocationCallOrder[0]);
  });
});
```

```typescript
// src/app/api/affiliate/click/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer only — PARTNERS is the real registry.
const { recordAffiliateClick } = vi.hoisted(() => ({ recordAffiliateClick: vi.fn() }));
vi.mock("@/lib/affiliate-clicks", () => ({ recordAffiliateClick }));

import { POST } from "./route";

// Distinct IPs per test — the rate limiter is module state shared across tests.
function click(body: unknown, ip: string): Request {
  return new Request("http://localhost:3001/api/affiliate/click", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/affiliate/click (review HIGH-1 hardening)", () => {
  beforeEach(() => recordAffiliateClick.mockClear());

  it("records a click for a known enabled partner", async () => {
    const res = await POST(click({ partner_id: "hotels_cj", trip_id: 7, session_id: "s-1" }, "198.51.100.1"));
    expect(res.status).toBe(200);
    expect(recordAffiliateClick).toHaveBeenCalledWith({ partnerId: "hotels_cj", tripId: 7, sessionId: "s-1" });
  });

  it("rejects prototype-chain keys (Object.hasOwn, not `in`)", async () => {
    for (const key of ["toString", "constructor", "hasOwnProperty"]) {
      const res = await POST(click({ partner_id: key }, "198.51.100.2"));
      expect(res.status).toBe(400);
    }
    expect(recordAffiliateClick).not.toHaveBeenCalled();
  });

  it("rejects disabled partners — no UI surface can produce such a click", async () => {
    const res = await POST(click({ partner_id: "airadvisor_cj" }, "198.51.100.3"));
    expect(res.status).toBe(400);
    expect(recordAffiliateClick).not.toHaveBeenCalled();
  });

  it("throttles per IP but still answers { ok: true } so beacons never break", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await POST(click({ partner_id: "klook" }, "198.51.100.4"));
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(200); // throttled response is NOT a 429
    expect(recordAffiliateClick).toHaveBeenCalledTimes(30); // the 31st insert was swallowed
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/components/AffiliateLink.test.tsx src/lib/affiliate-opener.test.ts src/app/api/affiliate/click/route.test.ts`
Expected: FAIL — the `./AffiliateLink`, `./affiliate-opener`, and `./route` modules do not exist yet.

- [ ] **Step 3: Implement all three files + the one-line tsconfig lib bump**

```typescript
// src/lib/affiliate-opener.ts
// Client-side affiliate opener + click logger (spec §3.2 / §3.4). One choke
// point for tracking, rel, and a future iframe embedMode (H6). Safe to import
// from server modules — no top-level browser API access.
import { PARTNERS, type PartnerId } from "@/config/affiliates";

export interface AffiliateClickContext {
  tripId?: number | null;
  sessionId?: string | null;
}

function readFallbackTripId(): number | null {
  try {
    const el = document.getElementById("atlas-trip-context");
    if (!el) return null;
    const data = JSON.parse(el.textContent || "{}");
    const id = data.tripId ?? data.trip_id ?? data.id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

function readFallbackSessionId(): string | null {
  try {
    return sessionStorage.getItem("atlas_session_id");
  } catch {
    return null;
  }
}

// Best-effort and non-blocking (spec §3.4): a failed log must NEVER block or
// delay the outbound navigation, so this fires a beacon and forgets it.
export function logAffiliateClick(partnerId: PartnerId, ctx?: AffiliateClickContext): void {
  try {
    const payload = JSON.stringify({
      partner_id: partnerId,
      trip_id: ctx?.tripId ?? readFallbackTripId(),
      session_id: ctx?.sessionId ?? readFallbackSessionId(),
    });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/affiliate/click", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/affiliate/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // never throw from a click logger
  }
}

// Programmatic opener for non-anchor call sites. embedMode is "newtab" for
// every current partner (H6) — an iframe path is intentionally NOT built.
export function openAffiliate(
  partnerId: PartnerId,
  opts?: { params?: Record<string, string>; href?: string } & AffiliateClickContext
): void {
  const partner = PARTNERS[partnerId];
  if (!partner || !partner.enabled) return;
  const url = opts?.href ?? partner.buildUrl(opts?.params);
  if (!url) return;
  logAffiliateClick(partnerId, opts);
  window.open(url, "_blank", "noopener,noreferrer");
}
```

```tsx
// src/components/AffiliateLink.tsx
"use client";
// The ONE way to render an affiliate anchor (spec §3.2): rel, target, and
// click logging are set here — never per call site.
import type { ReactNode } from "react";
import { PARTNERS, type PartnerId } from "@/config/affiliates";
import { logAffiliateClick } from "@/lib/affiliate-opener";

interface AffiliateLinkProps {
  partnerId: PartnerId;
  /** Pre-built affiliate URL (e.g. a tool-returned book_url). Wins over params. */
  href?: string;
  /** Params for the partner's buildUrl when no pre-built href exists. */
  params?: Record<string, string>;
  tripId?: number | null;
  sessionId?: string | null;
  className?: string;
  children: ReactNode;
}

export default function AffiliateLink({
  partnerId,
  href,
  params,
  tripId,
  sessionId,
  className,
  children,
}: AffiliateLinkProps) {
  const partner = PARTNERS[partnerId];
  if (!partner || !partner.enabled) return null;
  const url = href ?? partner.buildUrl(params);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      className={className}
      onClick={() => logAffiliateClick(partnerId, { tripId, sessionId })}
    >
      {children}
    </a>
  );
}
```

```typescript
// src/app/api/affiliate/click/route.ts
import { NextResponse } from "next/server";
import { PARTNERS, type PartnerId } from "@/config/affiliates";
import { recordAffiliateClick } from "@/lib/affiliate-clicks";

// Unauthenticated by design — guest clicks must count, and sendBeacon can't
// carry auth. Metric integrity (this phase's deliverable) is protected
// instead (review HIGH-1):
//  1. partner_id is validated with Object.hasOwn against the PARTNERS
//     registry — NEVER the `in` operator, which walks the prototype chain
//     and would accept "toString"/"constructor" as partner ids;
//  2. disabled partners are rejected — no UI surface can render one, so any
//     such click is synthetic by definition;
//  3. writes are rate-limited per IP, reusing the in-memory pattern from
//     src/app/api/assistant/chat/route.ts. Throttled beacons still get
//     { ok: true } — a click logger must never break or delay navigation.
// (A soft same-origin Origin/Referer check was reviewed and left out as
// optional hardening — revisit in Phase 2A if bot noise shows up.)

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30; // clicks/min/IP — generous for humans, a cheap wall for bots
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  // Lazy sweep instead of the chat route's setInterval: this module is
  // imported by a unit test, and a module-scope timer would leak into the
  // vitest worker. Same map shape, same window semantics.
  if (rateLimitMap.size > 1_000) {
    for (const [k, e] of rateLimitMap) {
      if (now >= e.resetAt) rateLimitMap.delete(k);
    }
  }
  const entry = rateLimitMap.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { partner_id, trip_id, session_id } = (body ?? {}) as Record<string, unknown>;
  if (typeof partner_id !== "string" || !Object.hasOwn(PARTNERS, partner_id)) {
    return NextResponse.json({ error: "Unknown partner" }, { status: 400 });
  }
  const partner = PARTNERS[partner_id as PartnerId];
  if (!partner.enabled) {
    return NextResponse.json({ error: "Unknown partner" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    // Swallow, don't 429 — the beacon is fire-and-forget; over-limit clicks
    // are simply not counted.
    return NextResponse.json({ ok: true });
  }
  recordAffiliateClick({
    partnerId: partner_id,
    tripId: typeof trip_id === "number" && Number.isInteger(trip_id) ? trip_id : null,
    sessionId:
      typeof session_id === "string" && session_id.length > 0 && session_id.length <= 128
        ? session_id
        : null,
  });
  return NextResponse.json({ ok: true });
}
```

And in `tsconfig.json`, change ONE line: `"lib": ["DOM", "DOM.Iterable", "ES2020"]` → `"lib": ["DOM", "DOM.Iterable", "ES2022"]`. `Object.hasOwn` is an ES2022 lib type — without the bump, `npm run build` fails typecheck. The change is typecheck-only (`noEmit: true`; Next transpiles with SWC, not tsc) and every supported runtime (Node ≥ 16.9, all evergreen browsers) implements `Object.hasOwn`. Do not change `target` or anything else in the file.

- [ ] **Step 4: Run tests + lint to verify**

Run: `npm run test:unit -- src/components/AffiliateLink.test.tsx src/lib/affiliate-opener.test.ts src/app/api/affiliate/click/route.test.ts && npm run lint`
Expected: PASS (12 tests — 6 + 2 + 4); lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/affiliate-opener.ts src/components/AffiliateLink.tsx src/app/api/affiliate/click/route.ts tsconfig.json src/components/AffiliateLink.test.tsx src/lib/affiliate-opener.test.ts src/app/api/affiliate/click/route.test.ts
git commit -m "feat(monetization): centralized affiliate opener, AffiliateLink component, hardened click endpoint"
```

---

### Task 4: Tiqets / Kiwi.com / Kiwitaxi registry entries (ids pending — enabled:false)

**Files:**
- Modify: `src/config/affiliates.ts` (the `PartnerId` union + `PARTNERS` object from Task 2)
- Test: `src/config/affiliates.test.ts` (extend)

**Interfaces:**
- Produces: `PartnerId` union extended with `"tiqets" | "kiwi" | "kiwitaxi"`; registry entries for all three (D7 success criterion 1 — the registry now contains Klook, Tiqets, Kiwi.com, Kiwitaxi + the CJ set).
- Produces: `TP_PROGRAM_IDS` (module-private) — per-partner `{ campaignId, p } | null`. **Only Klook's ids (`137`/`4110`) are known.** The other three are `null` = NEEDS CONFIRMATION from Jose (Travelpayouts dashboard → Tools → Link generator, for site travelplaninfo.com / trs `500721`). While `null`, `buildUrl` returns `""` and the partner stays `enabled:false`, so no surface can render or open a non-earning link. Going live later = paste ids + flip `enabled` (one-line change per partner).

**HARD RULE:** do NOT guess `campaign_id`/`p` values, do NOT copy them from another site's links (`trs=28242`/`28243` links in `command-post/` belong to travelsfy/airportspickup), do NOT use `p=4001`, and do NOT append params to any `tpx.li` URL.

- [ ] **Step 1: Write the failing tests**

Append to `src/config/affiliates.test.ts`:

```typescript
describe("D7 partner-set completeness (Phase 3 Task 3 of the spec)", () => {
  it("registry contains exactly the D7 set (spec success criterion 1)", () => {
    expect(Object.keys(PARTNERS).sort()).toEqual([
      "airadvisor_cj",
      "aviasales",
      "cruisedirect_cj",
      "economybookings_cj",
      "hotels_cj",
      "kiwi",
      "kiwitaxi",
      "klook",
      "tiqets",
      "vrbo_cj",
    ]);
  });

  it("tiqets/kiwi/kiwitaxi stay disabled with no buildable URL until their TP ids are confirmed (O4)", () => {
    for (const id of ["tiqets", "kiwi", "kiwitaxi"] as const) {
      expect(PARTNERS[id].enabled).toBe(false);
      expect(PARTNERS[id].network).toBe("travelpayouts");
      expect(PARTNERS[id].buildUrl({ city: "Miami" })).toBe("");
    }
  });

  it("no partner ever builds the unsubscribed p=4001 campaign or appends params to tpx.li", () => {
    for (const partner of Object.values(PARTNERS)) {
      const url = partner.buildUrl({ city: "Miami", origin: "MIA", destination: "CUN" });
      expect(url).not.toContain("p=4001");
      if (url.includes("tpx.li")) {
        expect(url).not.toContain("?");
      }
    }
  });

  it("classifies the new partner hosts as affiliate for the prose rel patch", () => {
    expect(isAffiliateHost("https://www.tiqets.com/en/miami-attractions")).toBe(true);
    expect(isAffiliateHost("https://www.kiwi.com/en/search")).toBe(true);
    expect(isAffiliateHost("https://kiwitaxi.com/")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/config/affiliates.test.ts`
Expected: FAIL — the exact-set assertion and the three new entries are missing. (All Task 2 tests must still pass.)

- [ ] **Step 3: Implement**

In `src/config/affiliates.ts`:

1. Extend the union:

```typescript
export type PartnerId =
  | "hotels_cj"
  | "vrbo_cj"
  | "cruisedirect_cj"
  | "economybookings_cj"
  | "airadvisor_cj"
  | "aviasales"
  | "klook"
  | "tiqets"
  | "kiwi"
  | "kiwitaxi";
```

2. Add, directly above the `PARTNERS` declaration:

```typescript
// Travelpayouts program ids for TPI (trs 500721 = travelplaninfo.com site id,
// marker 164743 — both confirmed in credentials). Klook is live (campaign 137
// / p 4110, mirrored from TP_KLOOK). Tiqets, Kiwi.com and Kiwitaxi are
// approved TPI programs (D7) but their campaign_id/p pairs are NOT in this
// repo: Jose must generate each partner link for travelplaninfo.com in the
// Travelpayouts dashboard (Tools → Link generator) and paste the ids here,
// then flip that partner's enabled flag — or let optional Task 4b fetch them
// from the TP API. NEVER guess ids — an unsubscribed campaign 400s at click
// time (the Booking.com campaign-4001 incident; token deliberately not
// written =-joined here so the Task 10 grep guard stays clean). NEVER append
// params to tpx.li short links.
const TP_PROGRAM_IDS: Record<
  "klook" | "tiqets" | "kiwi" | "kiwitaxi",
  { campaignId: number; p: number } | null
> = {
  klook: { campaignId: 137, p: 4110 },
  tiqets: null, // NEEDS CONFIRMATION (plan note O4)
  kiwi: null, // NEEDS CONFIRMATION (plan note O4)
  kiwitaxi: null, // NEEDS CONFIRMATION (plan note O4)
};

function tpMediaUrl(ids: { campaignId: number; p: number }, targetUrl: string): string {
  return `https://tp.media/r?campaign_id=${ids.campaignId}&marker=${TP_CONFIG.marker}&p=${ids.p}&trs=500721&u=${encodeURIComponent(targetUrl)}`;
}
```

3. Add the three entries inside `PARTNERS` (after `klook`):

```typescript
  tiqets: {
    id: "tiqets",
    network: "travelpayouts",
    label: "Tiqets",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: false, // flip only after TP_PROGRAM_IDS.tiqets is confirmed (O4)
    hosts: ["tiqets.com"],
    buildUrl: (params) => {
      const ids = TP_PROGRAM_IDS.tiqets;
      if (!ids) return "";
      const target = params?.city
        ? `https://www.tiqets.com/en/search?q=${encodeURIComponent(params.city)}`
        : "https://www.tiqets.com/en/";
      return tpMediaUrl(ids, target);
    },
  },
  kiwi: {
    id: "kiwi",
    network: "travelpayouts",
    label: "Kiwi.com",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: false, // flip only after TP_PROGRAM_IDS.kiwi is confirmed (O4)
    hosts: ["kiwi.com"],
    buildUrl: () => {
      const ids = TP_PROGRAM_IDS.kiwi;
      if (!ids) return "";
      return tpMediaUrl(ids, "https://www.kiwi.com/en/");
    },
  },
  kiwitaxi: {
    id: "kiwitaxi",
    network: "travelpayouts",
    label: "Kiwitaxi",
    embedMode: "newtab",
    rel: "sponsored",
    enabled: false, // flip only after TP_PROGRAM_IDS.kiwitaxi is confirmed (O4)
    hosts: ["kiwitaxi.com"],
    buildUrl: () => {
      const ids = TP_PROGRAM_IDS.kiwitaxi;
      if (!ids) return "";
      return tpMediaUrl(ids, "https://kiwitaxi.com/");
    },
  },
```

4. **Guard tightening (review NIT-4)** — in `src/lib/atlas/system-prompt.test.ts`, the existing test named `"does not mention Tiqets, Kiwi.com, or Kiwitaxi (not yet configured)"` asserts only `/tiqets/i` and `/kiwitaxi/i`; add the missing assertion so the test's name is true (a bare `/kiwi/i` would collide with "kiwitaxi" — use the dotted form):

```typescript
    expect(prompt).not.toMatch(/kiwi\.com/i);
```

(This passes immediately — not a TDD step, just making the guard this task leans on match its name.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- src/config/affiliates.test.ts src/lib/atlas/system-prompt.test.ts`
Expected: PASS — including the pre-existing `system-prompt.test.ts` guard ("does not mention Tiqets, Kiwi.com, or Kiwitaxi"), now with its `/kiwi\.com/i` assertion: registry entries must NOT leak into the system prompt, and this task touches no prompt code (only that guard test).

- [ ] **Step 5: Commit**

```bash
git add src/config/affiliates.ts src/config/affiliates.test.ts src/lib/atlas/system-prompt.test.ts
git commit -m "feat(monetization): register Tiqets/Kiwi.com/Kiwitaxi partners (disabled until TP ids confirmed)"
```

---

### Task 4b (OPTIONAL — MAIN SESSION ONLY, non-blocking): fetch the Tiqets/Kiwi.com/Kiwitaxi ids from the Travelpayouts API

**Added on review (HIGH-2).** The plan-author role was read-only, but the main session is not — the missing O4 ids may be obtainable NOW instead of waiting on Jose. API-returned ids are ground truth, not guesses, so using them is fully compliant with the never-invent rule (all three are already-approved TPI programs per the MEMORY affiliate set).

**Who runs it:** the MAIN SESSION only (needs `~/.openclaw/credentials/travelpayouts.json`). Hermes executors: SKIP this task entirely — it is not part of your gate, and Tasks 5–10 do not depend on it in either outcome.

**When:** any time after Task 4 lands and before the Task 11 Step 3 merge. Skipping it is always safe — the three partners simply stay `enabled:false` pending Jose (O4), which is this phase's accepted definition of done (spec success criterion 1).

- [ ] **Step 1:** Run `command-post/generate_tp_links.py` against the Travelpayouts API for site travelplaninfo.com (marker `164743`, trs `500721`) and attempt to obtain the per-program `campaign_id`/`p` pair (and canonical landing URL) for Tiqets, Kiwi.com, and Kiwitaxi. Capture the raw output as evidence.
- [ ] **Step 2:** For EACH partner whose ids the API returned (any subset is fine): paste the pair into `TP_PROGRAM_IDS`, correct that partner's `u=` landing target to what the API returned (the Task 4 targets are placeholders), flip its `enabled: true`, and update the Task 4 tests — move it out of the `"tiqets/kiwi/kiwitaxi stay disabled…"` loop and assert instead that its `buildUrl({ city: "Miami" })` contains `tp.media/r`, its own `campaign_id=…`/`p=…`, `trs=500721`, and `marker=164743`.
- [ ] **Step 3:** Re-verify: `npm run test:unit -- src/config/affiliates.test.ts src/lib/atlas/system-prompt.test.ts` — all green. (The campaign/tpx.li safety test now exercises the real URLs; the system-prompt guard must still pass — registry entries never leak into the prompt.)
- [ ] **Step 4:** Commit: `git add src/config/affiliates.ts src/config/affiliates.test.ts && git commit -m "feat(monetization): enable <partners> with TP-API-confirmed Travelpayouts ids (O4)"`

**If the API yields nothing (or only some programs):** the unresolved partners stay exactly as Task 4 left them — present the remainder to Jose at the Task 11 Step 4 gate as before. NEVER guess ids, never the banned Booking.com campaign, never params on `tpx.li`.

---

### Task 5: Extract `renderMarkdownLite` to a module + host-based `rel="sponsored"` for prose links

**Files:**
- Create: `src/lib/atlas/markdown-lite.ts`
- Modify: `src/components/AssistantChat.tsx` (delete the module-scope `escapeHtml` at ~386–393 and `renderMarkdownLite` at ~395–465; import from the new module instead)
- Test: `src/lib/atlas/markdown-lite.test.ts` (new)

**Interfaces:**
- Produces: `renderMarkdownLite(text: string): string` — byte-for-byte the same behavior as the current private function in `AssistantChat.tsx` (escape HTML → bold → links → tables → `<br/>`), with ONE change: absolute links whose host passes `isAffiliateHost()` (Task 2) render `rel="sponsored noopener noreferrer"`; all other absolute links keep `rel="noopener noreferrer"`; relative links unchanged. This closes the `AssistantChat.tsx:404` gap for every prose link, including the D3 partner handoffs.
- Note for the implementer: inside `renderMarkdownLite` the text has already been through `escapeHtml`, so URLs contain `&amp;` — that only affects the query string, never the hostname, so `new URL()` host classification inside `isAffiliateHost` is unaffected.
- Task 8 later adds `extractPartnerHandoff` to this same module.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/atlas/markdown-lite.test.ts
import { describe, it, expect } from "vitest";
import { renderMarkdownLite } from "./markdown-lite";

describe("renderMarkdownLite rel-by-host (spec §3.5)", () => {
  it("marks affiliate-host links sponsored", () => {
    const html = renderMarkdownLite(
      "[Search hotels in Miami on Hotels.com](https://www.dpbolvw.net/click-101692716-15734399?sid=travelplaninfo)"
    );
    expect(html).toContain('rel="sponsored noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("marks tp.media (Klook) links sponsored", () => {
    const html = renderMarkdownLite(
      "[Search activities and tours in Miami on Klook](https://tp.media/r?campaign_id=137&marker=164743&p=4110&trs=500721&u=x)"
    );
    expect(html).toContain('rel="sponsored noopener noreferrer"');
  });

  it("keeps Google Maps links plain noopener (never mislabel non-affiliate)", () => {
    const html = renderMarkdownLite(
      "[Search restaurants in Miami on Google Maps](https://www.google.com/maps/search/restaurants+in+Miami)"
    );
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("sponsored");
  });

  it("keeps relative TPI article links unmarked", () => {
    const html = renderMarkdownLite("[Miami guide](/miami-guide)");
    expect(html).not.toContain("sponsored");
    expect(html).not.toContain("target=");
  });

  it("still renders bold, line breaks, and tables like the original", () => {
    expect(renderMarkdownLite("**bold**")).toContain("<strong>bold</strong>");
    expect(renderMarkdownLite("a\nb")).toBe("a<br/>b");
    const table = renderMarkdownLite("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(table).toContain("<table");
    expect(table).toContain("<th");
  });

  it("escapes HTML from the model (XSS guard preserved)", () => {
    expect(renderMarkdownLite("<script>alert(1)</script>")).not.toContain("<script>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/atlas/markdown-lite.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/atlas/markdown-lite.ts` by MOVING the two functions verbatim from `AssistantChat.tsx` (anchors: `function escapeHtml(text: string): string {` and `function renderMarkdownLite(text: string) {` through its closing `return html;\n}`), exporting `renderMarkdownLite`, and replacing ONLY the absolute-link replace (the one currently at `AssistantChat.tsx:401-405`) with:

```typescript
import { isAffiliateHost } from "@/config/affiliates";
```

(at the top of the new module) and, inside `renderMarkdownLite`:

```typescript
  // Links — only allow http(s) URLs to prevent javascript: protocol injection.
  // Affiliate hosts additionally get rel="sponsored" (FTC/Google disclosure);
  // the host allowlist lives in PARTNERS — never mark non-affiliate links.
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_match, label: string, url: string) => {
      const rel = isAffiliateHost(url) ? "sponsored noopener noreferrer" : "noopener noreferrer";
      return `<a href="${url}" class="text-orange-600 hover:underline" target="_blank" rel="${rel}">${label}</a>`;
    }
  );
```

The relative-URL replace, the table conversion, and the `<br/>` handling move over UNCHANGED. Keep `escapeHtml` module-private.

In `src/components/AssistantChat.tsx`:
1. Delete the moved `escapeHtml` + `renderMarkdownLite` definitions (including the `// ── Markdown-lite renderer ──…` banner comment).
2. Add to the imports: `import { renderMarkdownLite } from "@/lib/atlas/markdown-lite";`
3. The four call sites (`renderMarkdownLite(summary)` ×2 and `renderMarkdownLite(part.text || "")` ×2) are unchanged.

- [ ] **Step 4: Run tests + lint + build to verify**

Run: `npm run test:unit -- src/lib/atlas/markdown-lite.test.ts && npm run lint && npm run build`
Expected: tests PASS (6/6); lint and build clean (AssistantChat compiles against the new import).

- [ ] **Step 5: Commit**

```bash
git add src/lib/atlas/markdown-lite.ts src/lib/atlas/markdown-lite.test.ts src/components/AssistantChat.tsx
git commit -m "feat(monetization): host-based rel=sponsored for Atlas prose links via extracted markdown-lite"
```

---

### Task 6: Migrate high-value render sites onto `AffiliateLink` / fix remaining `rel` gaps

**Files:**
- Modify: `src/components/atlas/FlightCard.tsx` (anchor at lines 43–53)
- Modify: `src/components/atlas/DealCard.tsx` (anchor at lines 28–38)
- Modify: `src/components/atlas/TripResultsModal.tsx` (flight anchor at lines 585–595 ONLY — the hotel anchor at ~697–707 is deleted wholesale in Task 7; do not touch it here)
- Modify: `src/app/[locale]/destinations/page.tsx` (flight anchors at 283–290 and 323–330; delete the now-unused `flightUrl` helper at ~163)
- Modify: `src/components/TripModes.tsx` (the `secondaryCta` anchor rel at line 57)
- Test: `src/components/atlas/FlightCard.test.tsx`, `src/components/atlas/DealCard.test.tsx` (new)

**Interfaces:**
- Consumes: `<AffiliateLink>` (Task 3), `isAffiliateHost` (Task 2).
- Produces: every migrated anchor now carries `sponsored noopener noreferrer` AND fires the click beacon. Tool-returned URLs (`book_url`, `search_url`) pass through the `href` prop verbatim — never rebuilt.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/atlas/FlightCard.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import FlightCard from "./FlightCard";

describe("FlightCard affiliate anchor", () => {
  beforeEach(() => cleanup());

  it("renders the book link with rel=sponsored and the tool-returned URL untouched", () => {
    render(
      <FlightCard
        flight={{
          airline: "American",
          route: "MIA → CUN",
          price: "$210",
          duration: "1h 45m",
          stops: "Nonstop",
          book_url: "https://www.aviasales.com/search/MIA0109CUN1?marker=164743",
        }}
      />
    );
    const link = screen.getByRole("link");
    const rel = (link.getAttribute("rel") || "").split(/\s+/);
    expect(rel).toEqual(expect.arrayContaining(["sponsored", "noopener", "noreferrer"]));
    expect(link.getAttribute("href")).toBe("https://www.aviasales.com/search/MIA0109CUN1?marker=164743");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
```

```tsx
// src/components/atlas/DealCard.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DealCard from "./DealCard";

describe("DealCard affiliate anchor", () => {
  beforeEach(() => cleanup());

  it("renders the deal link with rel=sponsored and the tool-returned URL untouched", () => {
    render(
      <DealCard
        deal={{
          date: "2026-09-12",
          destination: "Cancún",
          price: "$189",
          savings_pct: 24,
          search_url: "https://www.aviasales.com/search/MIA1209CUN1?marker=164743",
        }}
      />
    );
    const link = screen.getByRole("link", { name: /View Deal/ });
    const rel = (link.getAttribute("rel") || "").split(/\s+/);
    expect(rel).toEqual(expect.arrayContaining(["sponsored", "noopener", "noreferrer"]));
    expect(link.getAttribute("href")).toContain("marker=164743");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/components/atlas/FlightCard.test.tsx src/components/atlas/DealCard.test.tsx`
Expected: FAIL — both anchors currently render `rel="noopener noreferrer"` without `sponsored`.

- [ ] **Step 3: Implement**

**`src/components/atlas/FlightCard.tsx`** — add `import AffiliateLink from "@/components/AffiliateLink";` and replace the anchor block

```tsx
      <a
        href={flight.book_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-full px-3 py-1.5 transition-colors"
      >
```

with

```tsx
      <AffiliateLink
        partnerId="aviasales"
        href={flight.book_url}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-full px-3 py-1.5 transition-colors"
      >
```

and the matching closing `</a>` with `</AffiliateLink>`. Children (label + svg) unchanged.

**`src/components/atlas/DealCard.tsx`** — same transformation for the `deal.search_url` anchor: `<AffiliateLink partnerId="aviasales" href={deal.search_url} className="…same…">…</AffiliateLink>`; add the same import.

**`src/components/atlas/TripResultsModal.tsx`** — add `import AffiliateLink from "@/components/AffiliateLink";` and replace ONLY the flights-tab anchor

```tsx
                          <a
                            href={f.book_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-full px-4 py-2 transition-colors"
                          >
                            Book on Aviasales
```

with

```tsx
                          <AffiliateLink
                            partnerId="aviasales"
                            href={f.book_url}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-full px-4 py-2 transition-colors"
                          >
                            Book on Aviasales
```

(and its closing tag). Leave the hotels-tab anchor ("Find on Hotels.com") untouched — Task 7 deletes that entire tab.

**`src/app/[locale]/destinations/page.tsx`** (a `"use client"` page) — add `import AffiliateLink from "@/components/AffiliateLink";`, then:

1. Replace the per-destination flight anchor

```tsx
                    <a
                      href={flightUrl(dest)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center bg-orange-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-orange-700 transition-colors"
                    >
                      {t("findFlights")}
                    </a>
```

with

```tsx
                    <AffiliateLink
                      partnerId="aviasales"
                      params={{ origin: "JFK", destination: dest.iata }}
                      className="flex-1 text-center bg-orange-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-orange-700 transition-colors"
                    >
                      {t("findFlights")}
                    </AffiliateLink>
```

2. Replace the CTA-section flight anchor

```tsx
            <a
              href={`https://www.aviasales.com/?marker=${TP_CONFIG.marker}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-orange-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-orange-700 transition-colors inline-block"
            >
              {t("searchAllFlights")}
            </a>
```

with

```tsx
            <AffiliateLink
              partnerId="aviasales"
              className="bg-orange-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-orange-700 transition-colors inline-block"
            >
              {t("searchAllFlights")}
            </AffiliateLink>
```

3. Delete the now-unused `flightUrl` function (`function flightUrl(dest: typeof destinations[0]) { return TP_CONFIG.searchUrl("JFK", dest.iata); }`). If `TP_CONFIG` is then unused in this file, remove it from the import; keep `CJ_LINKS` (still used by the hotel/cars anchors, which already carry `sponsored` and are NOT touched).

**`src/components/TripModes.tsx`** — add `import { isAffiliateHost } from "@/config/affiliates";` and change the secondary-CTA anchor's rel from

```tsx
                    rel="noopener noreferrer"
```

to

```tsx
                    rel={isAffiliateHost(mode.secondaryCta.href) ? "sponsored noopener noreferrer" : "noopener noreferrer"}
```

(The CJ cruise deep links in `src/content/tripModes.ts` become sponsored; Jose's own transport sites — airportspickup.com, 123corporatetransportation.com — and internal `/planner` links stay plain. Do not edit `src/content/tripModes.ts`.)

**Accepted gap (review MEDIUM-1):** the two CJ cruise deep links here gain `sponsored` but intentionally do NOT log clicks in this phase. Migrating them onto `<AffiliateLink partnerId="cruisedirect_cj">` was considered and declined: the same anchor also renders non-affiliate hrefs (Jose's transport sites, internal `/planner`), so a conditional component split would reintroduce a literal plain-noopener anchor on the non-affiliate branch and break Task 10's `rel` grep guard. TripModes is therefore listed as a rel-only surface in the Goal's click-metric scope statement; migrate it in a later pass if its click volume ever matters.

- [ ] **Step 4: Run tests + lint + build to verify**

Run: `npm run test:unit -- src/components/atlas/FlightCard.test.tsx src/components/atlas/DealCard.test.tsx && npm run lint && npm run build`
Expected: PASS; lint/build clean.

Then verify no plain-noopener literal remains in the touched files:

Run: `grep -n 'rel="noopener noreferrer"' src/components/atlas/FlightCard.tsx src/components/atlas/DealCard.tsx "src/app/[locale]/destinations/page.tsx" src/components/TripModes.tsx`
Expected: NO output. (The already-sponsored anchors in destinations/page.tsx use `rel="noopener noreferrer sponsored"`, which this pattern does not match; TripModes' ternary is a JSX expression, so the literal `rel="noopener noreferrer"` no longer exists there. Any hit means a site was missed.)

- [ ] **Step 5: Commit**

```bash
git add src/components/atlas/FlightCard.tsx src/components/atlas/DealCard.tsx src/components/atlas/TripResultsModal.tsx "src/app/[locale]/destinations/page.tsx" src/components/TripModes.tsx src/components/atlas/FlightCard.test.tsx src/components/atlas/DealCard.test.tsx
git commit -m "feat(monetization): migrate flight/deal render sites to AffiliateLink; host-based rel on TripModes"
```

---

### Task 7: D3 dead-path cleanup — AssistantChat, types, TripResultsModal, card deletions (TDD)

This is the largest task. The fabricated-inventory pipeline (`search_hotels`/`search_activities`/`search_restaurants` normalization → `HotelCard`/`ActivityCard`/`RestaurantCard` → `TripResultsModal` hotel/activity/restaurant tabs) is dead code under the 4-tool Phase-2 brain, but the shapes (`name`/`rating`/`price_night`) are D3-forbidden and must not be able to silently return. Write the tripwire tests FIRST.

**Files:**
- Modify: `src/lib/atlas/no-fabrication.test.ts` (extend — this is the failing test)
- Modify: `src/components/AssistantChat.tsx`
- Modify: `src/components/atlas/types.ts` (full rewrite, small)
- Modify: `src/components/atlas/TripResultsModal.tsx` (strip to Flights + Summary)
- Delete: `src/components/atlas/HotelCard.tsx`, `src/components/atlas/ActivityCard.tsx`, `src/components/atlas/RestaurantCard.tsx` (AssistantChat is their only importer — verified 2026-07-07; `src/components/ActivityCard.tsx` WITHOUT the `atlas/` prefix is a different, out-of-scope orphan — do not touch it)
- Modify: `src/lib/help-content.ts` (the three `planner-itinerary` entries that describe the modal's Hotels/Activities/Restaurants tabs — standing rule: help content must track feature changes)

**Interfaces:**
- Produces: `extractTripData(parts): { flights: FlightResult[] }` (hotels/activities/restaurants gone); `TRIP_TOOLS = new Set(["search_flights"])`; `interface ModalData { flights: FlightResult[]; tripContext: TripContext }`.
- Produces: `TripResultsModalProps` without `hotels`/`activities`/`restaurants`; `TABS = ["Flights", "Summary"]`.
- Produces: `src/components/atlas/types.ts` exporting ONLY `FlightResult` and `BudgetTier`.
- Behavior note: with `TRIP_TOOLS` reduced to one tool, `countTripTools` can never reach 2, so the multi-tool "View Full Plan" modal trigger becomes unreachable in practice. Keep the trigger machinery (smallest diff; it self-activates if a second real trip tool ever ships) and add the code comment shown below. Flights-only replies keep rendering inline `FlightCard`s exactly as today.

- [ ] **Step 1: Write the failing tests (extend `src/lib/atlas/no-fabrication.test.ts`)**

Add these imports at the top of the file:

```typescript
import { existsSync, readFileSync } from "fs";
import path from "path";
```

Append inside the existing `describe("Atlas D3 no-fabrication guarantees", …)` block:

```typescript
  describe("D3 dead-path cleanup tripwires (Phase 3 task 1)", () => {
    const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

    it("AssistantChat carries no fabricated-inventory tool plumbing", () => {
      const src = read("src/components/AssistantChat.tsx");
      for (const forbidden of [
        "search_hotels",
        "search_activities",
        "search_restaurants",
        "HotelResult",
        "ActivityResult",
        "RestaurantResult",
        "price_night",
      ]) {
        expect(src, `AssistantChat.tsx must not contain "${forbidden}"`).not.toContain(forbidden);
      }
    });

    it("atlas result types no longer define fabricated hotel/activity/restaurant shapes", () => {
      const src = read("src/components/atlas/types.ts");
      for (const forbidden of ["HotelResult", "ActivityResult", "RestaurantResult", "price_night"]) {
        expect(src, `types.ts must not contain "${forbidden}"`).not.toContain(forbidden);
      }
      // Word-bounded on purpose (review NIT-3): the bare substring "rating"
      // also matches unrelated words like "operating"; \brating\b still
      // catches `rating:` and `rating?:` field declarations.
      expect(src, "types.ts must not declare a rating field").not.toMatch(/\brating\b/);
    });

    it("TripResultsModal renders no fabricated inventory shapes", () => {
      const src = read("src/components/atlas/TripResultsModal.tsx");
      for (const forbidden of [
        "HotelResult",
        "ActivityResult",
        "RestaurantResult",
        "price_night",
        "selectedHotels",
        "selectedActivities",
        "selectedRestaurants",
      ]) {
        expect(src, `TripResultsModal.tsx must not contain "${forbidden}"`).not.toContain(forbidden);
      }
    });

    it("the fabricated-inventory card components are deleted", () => {
      for (const file of [
        "src/components/atlas/HotelCard.tsx",
        "src/components/atlas/ActivityCard.tsx",
        "src/components/atlas/RestaurantCard.tsx",
      ]) {
        expect(existsSync(path.join(process.cwd(), file)), `${file} must not exist`).toBe(false);
      }
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/lib/atlas/no-fabrication.test.ts`
Expected: FAIL on all four new cases (files still contain the forbidden tokens / card files exist). The three pre-existing cases must still pass.

- [ ] **Step 3: Clean up `src/components/AssistantChat.tsx`**

All anchors below exist at `4d5a1e7` (line numbers drift after Tasks 5–6 — grep the anchor text):

1. **Imports (lines 12–20):** delete the `HotelCard`, `ActivityCard`, `RestaurantCard` import lines. Change the types import to:
   ```tsx
   import type { FlightResult, BudgetTier } from "./atlas/types";
   ```
2. **`TRIP_TOOLS` (line 24):** replace with:
   ```tsx
   // Only real-data tools may trigger the trip-results flow. The three
   // fabricated-inventory search tools (hotels/activities/restaurants) are
   // D3-forbidden and must never be re-added — no-fabrication.test.ts greps
   // this file for their names, so they must not appear here even in comments
   // (review BLOCKER-1). With a single entry the multi-tool modal trigger
   // (countTripTools >= 2) is currently unreachable — it self-activates if a
   // second real trip tool ever ships.
   const TRIP_TOOLS = new Set(["search_flights"]);
   ```
3. **`interface ModalData` (lines 57–63):** replace with:
   ```tsx
   interface ModalData {
     flights: FlightResult[];
     tripContext: TripContext;
   }
   ```
4. **`extractTripData` (lines 162–245):** replace the whole function with:
   ```tsx
   /** Extract typed arrays from parsed tool results (flights only — D3: no fabricated inventory shapes) */
   function extractTripData(parts: ToolResult[]): { flights: FlightResult[] } {
     const flights: FlightResult[] = [];
     for (const p of parts) {
       if (p.type !== "tool" || !p.data) continue;
       if (p.toolName === "search_flights" && Array.isArray(p.data.flights)) {
         for (const f of p.data.flights as Record<string, unknown>[]) {
           const price = String(f.price || "$0");
           const duration = String(f.duration || "0h 0m");
           const stops = String(f.stops || "");
           flights.push({
             airline: String(f.airline || ""),
             route: String(f.route || ""),
             price,
             price_value: typeof f.price_value === "number" ? f.price_value : parsePriceValue(price),
             duration,
             duration_minutes:
               typeof f.duration_minutes === "number" ? f.duration_minutes : parseDurationMinutes(duration),
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
   ```
5. **`ToolResultCards` (lines 294–382):** delete the three branches `if (toolName === "search_hotels" && data.hotels) {…}`, `if (toolName === "search_activities" && data.activities) {…}`, `if (toolName === "search_restaurants" && data.restaurants) {…}` (each is a full `if` block returning a mapped card list). Keep `search_flights`, `get_deals`, `surprise_me`, `get_article`, and the raw-JSON fallback.
6. **Both `setModalData` call sites** (desktop ~1122–1131 and modal-mode ~1392–1401; anchor: `const tripData = extractTripData(parsed);` followed by `setModalData({`): replace the object literal with:
   ```tsx
                                   const tripData = extractTripData(parsed);
                                   const ctx = readTripContext();
                                   setModalData({ flights: tripData.flights, tripContext: ctx });
                                   setModalOpen(true);
   ```
   (keep each site's surrounding button/JSX untouched).
7. **Right-sidebar `allTrips` block (lines 1501–1588**, anchor `let allTrips = { flights: [] as FlightResult[]`): replace the whole IIFE body with:
   ```tsx
               {(() => {
                 let flights: FlightResult[] = [];
                 for (const msg of [...messages].reverse()) {
                   if (msg.role === "assistant") {
                     const parsed = parseMessageContent(msg.content);
                     const tripData = extractTripData(parsed);
                     if (tripData.flights.length > 0) {
                       flights = tripData.flights;
                       break;
                     }
                   }
                 }

                 if (flights.length === 0) {
                   return (
                     <div className="text-center text-gray-400 text-sm py-12">
                       <p className="text-3xl mb-3">📋</p>
                       <p>Trip details will appear here</p>
                     </div>
                   );
                 }

                 return (
                   <div>
                     <h3 className="font-bold text-gray-900 mb-3">✈️ Flights ({flights.length})</h3>
                     <div className="space-y-2">
                       {flights.map((f, i) => (
                         <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
                           <p className="font-bold text-orange-600 text-lg">{f.price}</p>
                           <p className="text-xs text-gray-600 font-medium">{f.airline}</p>
                           <p className="text-xs text-gray-500 mt-1">{f.route}</p>
                           {f.nonstop && (
                             <span className="text-xs bg-green-100 text-green-700 rounded px-2 py-0.5 inline-block mt-1">
                               Nonstop
                             </span>
                           )}
                         </div>
                       ))}
                     </div>
                   </div>
                 );
               })()}
   ```
8. **`TripResultsModal` invocation (lines 1595–1609):** replace with:
   ```tsx
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
   ```

- [ ] **Step 4: Rewrite `src/components/atlas/types.ts`**

Replace the entire file with:

```typescript
/** Shared types for Atlas trip result data — used by TripResultsModal + AssistantChat.
 *
 * D3 (no fabricated inventory): only real-data result shapes live here. The
 * fabricated hotel/activity/restaurant result types (invented names, star
 * counts, nightly prices) were removed in Phase 3 (2026-07-07) — do not add
 * them back. no-fabrication.test.ts greps this file for their old names, so
 * they must not appear here even in comments (review BLOCKER-1). */

/** Extends FlightData from FlightCard with fields needed for sort + badges */
export interface FlightResult {
  airline: string;
  route: string;
  price: string;          // display string, e.g. "$289"
  price_value: number;    // numeric for sorting (dollars)
  duration: string;       // e.g. "3h 15m"
  duration_minutes: number; // numeric for sorting
  stops: string;          // e.g. "Nonstop" or "1 stop"
  nonstop: boolean;       // for badge rendering
  depart_date?: string;
  return_date?: string;
  book_url: string;
}

/** Budget tier type reused across modal and chat */
export type BudgetTier = "budget" | "mid" | "luxury";
```

- [ ] **Step 5: Strip `src/components/atlas/TripResultsModal.tsx` to Flights + Summary**

Apply in order (anchors quoted; the file is 1048 lines at `4d5a1e7`):

1. Types import → `import type { FlightResult, BudgetTier } from "./types";`
2. `TABS` → `const TABS = ["Flights", "Summary"] as const;`
3. `TripResultsModalProps` → remove the `hotels: HotelResult[];`, `activities: ActivityResult[];`, `restaurants: RestaurantResult[];` members (and the same three from the destructured component parameters).
4. Delete state hooks: `hotelSort`, `selectedHotels`, `selectedActivities`, `selectedRestaurants`, `hotelDays`, `activityDays`, `restaurantDays` (keep `selectedFlights`, `flightDays`, `addingAll`, `addedMessage`, `flightSort`, `activeTab`).
5. `totalSelected` → `const totalSelected = selectedFlights.size;`
6. Delete the `sortedHotels` and `groupedActivities` memos, the whole `getDefaultDay` callback, and the `toggleHotel` / `toggleActivity` / `toggleRestaurant` callbacks (keep `toggleSelection` + `toggleFlight`; keep `nights`, `dayCount`, `sortedFlights`, `cheapestFlightValue`).
7. Replace the `summary` memo (anchor `const summary = useMemo(() => {` … `}, [flights, hotels, activities, …]);`) with:
   ```tsx
   const summary = useMemo(() => {
     const cheapestFlight = flights.length > 0 ? Math.min(...flights.map((f) => f.price_value)) : 0;
     const flightTotal = cheapestFlight * adults;
     const totalDays = nights > 0 ? nights : 1;
     return { flightTotal, avgPerDay: Math.round(flightTotal / totalDays) };
   }, [flights, adults, nights]);
   ```
8. Replace `handleAddAll` (anchor `const handleAddAll = useCallback(async () => {` through its dependency array) with the flights-only version:
   ```tsx
   const handleAddAll = useCallback(async () => {
     if (!tripId) {
       setAddedMessage("No active trip. Create a trip first.");
       return;
     }

     setAddingAll(true);
     setAddedMessage(null);

     interface BatchItem {
       day_number: number;
       category: string;
       title: string;
       description: string;
       price_estimate: string;
       affiliate_url: string;
     }

     const items: BatchItem[] = [];

     // Add selected flights (or cheapest if none selected)
     if (selectedFlights.size > 0) {
       for (const idx of selectedFlights) {
         const f = flights[idx];
         if (!f) continue;
         items.push({
           day_number: flightDays[idx] || 1,
           category: "flight",
           title: `${f.airline} ${f.route}`,
           description: `${f.duration} - ${f.stops} - ${f.price}`,
           price_estimate: f.price,
           affiliate_url: f.book_url,
         });
       }
     } else if (sortedFlights.length > 0) {
       const f = sortedFlights[0];
       const realIdx = flights.indexOf(f);
       items.push({
         day_number: flightDays[realIdx] || 1,
         category: "flight",
         title: `${f.airline} ${f.route}`,
         description: `${f.duration} - ${f.stops} - ${f.price}`,
         price_estimate: f.price,
         affiliate_url: f.book_url,
       });
     }

     if (items.length === 0) {
       setAddingAll(false);
       setAddedMessage("No items to add.");
       return;
     }

     try {
       const res = await fetch(`/api/trips/${tripId}/items/batch`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ items }),
       });

       if (res.ok) {
         const data = await res.json();
         setAddedMessage(`Added ${data.items?.length || items.length} items to your itinerary!`);
         setTimeout(() => window.location.reload(), 1500);
       } else {
         const err = await res.json().catch(() => ({ error: "Failed to add items" }));
         setAddedMessage(err.error || "Failed to add items");
       }
     } catch {
       setAddedMessage("Network error. Please try again.");
     }

     setAddingAll(false);
   }, [tripId, flights, sortedFlights, selectedFlights, flightDays]);
   ```
9. Tab-bar count logic (anchor `const count =\n                tab === "Flights"`): replace the nested ternary with `const count = tab === "Flights" ? flights.length : null;`
10. Delete the three whole tab panels: `{/* Hotels Tab */}` (div `id="panel-Hotels"` through its closing `</div>`), `{/* Activities Tab */}` (`id="panel-Activities"`), `{/* Restaurants Tab */}` (`id="panel-Restaurants"`). Keep the Flights panel (with its Task-6 `AffiliateLink`) intact.
11. Replace the Summary panel content (anchor `{/* Summary Tab */}` through the panel's closing `</div>`) with:
    ```tsx
          {/* Summary Tab */}
          <div
            role="tabpanel"
            id="panel-Summary"
            aria-labelledby="tab-Summary"
            className={activeTab === "Summary" ? "" : "hidden"}
          >
            <div className="space-y-6">
              {/* Cost breakdown — flights only. D3: hotels/activities/dining are
                  partner-search handoffs, never priced or listed here. */}
              <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Cost Breakdown</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      Flights (cheapest x {adults} {adults === 1 ? "adult" : "adults"})
                    </span>
                    <span className="font-medium text-gray-900">
                      ${summary.flightTotal.toLocaleString()}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-3 flex justify-between text-sm">
                    <span className="font-semibold text-gray-900">Estimated Flight Total</span>
                    <span className="font-bold text-lg text-orange-600">
                      ${summary.flightTotal.toLocaleString()}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Hotels, activities, and dining aren&apos;t priced here — Atlas hands those
                  searches to trusted partners instead of inventing listings.
                </p>
              </div>

              {/* Budget comparison */}
              <div className="bg-orange-50 rounded-xl p-5">
                <h3 className="font-semibold text-gray-900 mb-2">Budget Comparison</h3>
                <p className="text-sm text-gray-700">
                  Your budget tier:{" "}
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TIER_BADGE[budgetTier]}`}>
                    {TIER_LABEL[budgetTier]}
                  </span>{" "}
                  ({BUDGET_DAILY_RANGES[budgetTier]})
                </p>
                <p className="text-sm text-gray-700 mt-1">
                  Cheapest flights average{" "}
                  <span className="font-bold text-orange-600">${summary.avgPerDay}/day</span> across your trip
                </p>
              </div>
            </div>
          </div>
    ```
12. Sticky footer (anchor `Estimated total:{" "}`): replace the total expression with
    ```tsx
            <p className="text-sm text-gray-600">
              Estimated flight total:{" "}
              <span className="font-bold text-gray-900">${summary.flightTotal.toLocaleString()}</span>
            </p>
    ```
    (the `Add Selected (n) / Add All to Itinerary` button logic is unchanged — `totalSelected` now counts flights only).

- [ ] **Step 6: Delete the card components and update help content**

```bash
git rm src/components/atlas/HotelCard.tsx src/components/atlas/ActivityCard.tsx src/components/atlas/RestaurantCard.tsx
```

In `src/lib/help-content.ts` (`planner-itinerary` section — do NOT touch other entries):
- `"Auto-search"` entry text →
  `"When you first create a trip, Atlas automatically searches live flights. Results appear in a modal where you can compare, select, and add flights to your itinerary in bulk. For hotels, activities, and dining, Atlas gives honest guidance plus a trusted partner search link instead of invented listings."`
- `"Trip Results Modal"` entry text →
  `"The results modal has a Flights tab and a Summary. Sort flights, select with checkboxes, pick which day each belongs to, and click 'Add All to Itinerary' to batch-add. Hotel, activity, and restaurant searches hand off to trusted partners — TPI never invents listings or prices."`
- `"Day assignment"` entry text →
  `"Every flight in the results modal has a 'Day' dropdown so you can assign it to a specific day before adding it to the itinerary."`

- [ ] **Step 7: Run the full verification for this task**

Run: `npm run test:unit -- src/lib/atlas/no-fabrication.test.ts`
Expected: PASS (all 7 cases — 3 pre-existing + 4 new).

Run: `npm run test:unit && npm run lint && npm run build`
Expected: all green — the full unit suite proves nothing else referenced the deleted types/components.

Run: `grep -rn "HotelResult\|ActivityResult\|RestaurantResult" src/`
Expected: hits ONLY inside `src/lib/atlas/no-fabrication.test.ts` (the tripwire's own string literals).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(monetization): D3 dead-path cleanup — remove fabricated hotel/activity/restaurant shapes (guarded by no-fabrication tripwires)"
```

---

### Task 8: `PartnerHandoffCard` — promote the prose handoff link to a CTA card

**Files:**
- Modify: `src/lib/atlas/markdown-lite.ts` (add `extractPartnerHandoff`)
- Create: `src/components/atlas/PartnerHandoffCard.tsx`
- Create: `src/components/atlas/AtlasProse.tsx`
- Modify: `src/components/AssistantChat.tsx` (swap the four `renderMarkdownLite` render sites to `AtlasProse`)
- Modify: `src/lib/help-content.ts` (one-line wording touch-up)
- Test: `src/lib/atlas/markdown-lite.test.ts` (extend), `src/components/atlas/PartnerHandoffCard.test.tsx` (new)

**Interfaces:**
- Consumes: `renderMarkdownLite` (Task 5), `<AffiliateLink>` (Task 3), `PARTNERS` (Task 2).
- Produces: `extractPartnerHandoff(text: string): { text: string; handoff: PartnerHandoff | null }` where `PartnerHandoff = { label: string; url: string; partnerId: "hotels_cj" | "klook" }`. Mechanism per spec §3.6 (chosen over a `[TOOL:partner_handoff]` frame): `buildPartnerLinkInstructions` in `src/lib/atlas/system-prompt.ts:62-78` already makes Atlas END its reply with exactly one ready-made markdown link on a known host — the extractor promotes ONLY a final line that is exactly one markdown link on `dpbolvw.net` (→ `hotels_cj`) or `tp.media` (→ `klook`). Anything else (mid-text links, Google Maps restaurant handoffs, multiple links) renders as ordinary prose. The brain/system-prompt and tool loop are NOT touched.
- Produces: `<AtlasProse text>` — renders `renderMarkdownLite(remainder)` in a span plus `<PartnerHandoffCard>` when a handoff was extracted. Trip/session click attribution comes from `logAffiliateClick`'s DOM fallbacks (Task 3) — no props to thread.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/atlas/markdown-lite.test.ts`:

```typescript
import { extractPartnerHandoff } from "./markdown-lite";

describe("extractPartnerHandoff (spec §3.6 renderer promotion)", () => {
  it("promotes a trailing Hotels.com handoff line and strips it from the prose", () => {
    const msg =
      "South Beach is walkable and mid-tier hotels run $150-250.\n\n[Search hotels in Miami on Hotels.com](https://www.dpbolvw.net/click-101692716-15734399?sid=travelplaninfo)";
    const { text, handoff } = extractPartnerHandoff(msg);
    expect(handoff).toEqual({
      label: "Search hotels in Miami on Hotels.com",
      url: expect.stringContaining("dpbolvw.net"),
      partnerId: "hotels_cj",
    });
    expect(text).toBe("South Beach is walkable and mid-tier hotels run $150-250.");
  });

  it("promotes a trailing Klook (tp.media) handoff line", () => {
    const msg =
      "Plenty to do around Brickell.\n[Search activities and tours in Miami on Klook](https://tp.media/r?campaign_id=137&marker=164743&p=4110&trs=500721&u=x)";
    expect(extractPartnerHandoff(msg).handoff?.partnerId).toBe("klook");
  });

  it("leaves Google Maps restaurant handoffs as prose (not an affiliate card)", () => {
    const msg =
      "Try Wynwood for dinner.\n[Search restaurants in Miami on Google Maps](https://www.google.com/maps/search/restaurants+in+Miami)";
    expect(extractPartnerHandoff(msg).handoff).toBeNull();
    expect(extractPartnerHandoff(msg).text).toBe(msg);
  });

  it("ignores links that are not alone on the final line", () => {
    const msg =
      "[Search hotels in Miami on Hotels.com](https://www.dpbolvw.net/click-101692716-15734399) then keep reading this sentence.";
    expect(extractPartnerHandoff(msg).handoff).toBeNull();
  });
});
```

Create `src/components/atlas/PartnerHandoffCard.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import PartnerHandoffCard from "./PartnerHandoffCard";

describe("PartnerHandoffCard (D3 handoff CTA)", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(navigator, "sendBeacon", { value: vi.fn(() => true), configurable: true });
  });

  it("renders a sponsored partner CTA with no fabricated inventory", () => {
    render(
      <PartnerHandoffCard
        handoff={{
          label: "Search hotels in Miami on Hotels.com",
          url: "https://www.dpbolvw.net/click-101692716-15734399?sid=travelplaninfo",
          partnerId: "hotels_cj",
        }}
      />
    );
    const link = screen.getByRole("link", { name: /Search hotels in Miami on Hotels\.com/ });
    const rel = (link.getAttribute("rel") || "").split(/\s+/);
    expect(rel).toEqual(expect.arrayContaining(["sponsored", "noopener", "noreferrer"]));
    expect(link.getAttribute("href")).toContain("dpbolvw.net");
    expect(screen.getByText(/prices and listings shown there are real/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/lib/atlas/markdown-lite.test.ts src/components/atlas/PartnerHandoffCard.test.tsx`
Expected: FAIL — `extractPartnerHandoff` and the component do not exist.

- [ ] **Step 3: Implement**

Append to `src/lib/atlas/markdown-lite.ts`:

```typescript
export interface PartnerHandoff {
  label: string;
  url: string;
  partnerId: "hotels_cj" | "klook";
}

// Detects the single ready-made partner handoff line that
// buildPartnerLinkInstructions() (system-prompt.ts) makes Atlas append to a
// hotel/activity reply, and promotes it out of the prose so the UI can render
// a PartnerHandoffCard instead of an inline link (spec §3.6). Conservative by
// design: only a FINAL non-empty line that is exactly one markdown link on a
// known handoff host is promoted — everything else stays ordinary prose.
export function extractPartnerHandoff(text: string): { text: string; handoff: PartnerHandoff | null } {
  const trimmed = text.trimEnd();
  const lines = trimmed.split("\n");
  const lastLine = (lines[lines.length - 1] ?? "").trim();
  const match = lastLine.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
  if (!match) return { text, handoff: null };
  const [, label, url] = match;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { text, handoff: null };
  }
  const partnerId =
    hostname === "dpbolvw.net" || hostname.endsWith(".dpbolvw.net")
      ? ("hotels_cj" as const)
      : hostname === "tp.media"
        ? ("klook" as const)
        : null;
  if (!partnerId) return { text, handoff: null };
  return { text: lines.slice(0, -1).join("\n").trimEnd(), handoff: { label, url, partnerId } };
}
```

Create `src/components/atlas/PartnerHandoffCard.tsx`:

```tsx
"use client";
// D3 partner-search handoff CTA (spec §3.6): a styled affiliate button with NO
// invented hotel/activity names, ratings, or prices — purely a higher-CTR
// rendering of the link Atlas already emits.
import AffiliateLink from "@/components/AffiliateLink";
import { PARTNERS } from "@/config/affiliates";
import type { PartnerHandoff } from "@/lib/atlas/markdown-lite";

export default function PartnerHandoffCard({ handoff }: { handoff: PartnerHandoff }) {
  const partner = PARTNERS[handoff.partnerId];
  if (!partner?.enabled) return null;
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3 my-2 hover:shadow-md transition-shadow">
      <p className="text-xs text-gray-500 mb-2">
        Search live availability on {partner.label} — prices and listings shown there are real.
      </p>
      <AffiliateLink
        partnerId={handoff.partnerId}
        href={handoff.url}
        className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-full px-3 py-1.5 transition-colors"
      >
        {handoff.label}
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </AffiliateLink>
    </div>
  );
}
```

Create `src/components/atlas/AtlasProse.tsx`:

```tsx
"use client";
// Renders one Atlas prose segment: markdown-lite HTML plus, when the segment
// ends with the known partner-handoff link, a PartnerHandoffCard promotion
// (spec §3.6). Trip/session click attribution is resolved inside
// logAffiliateClick via its DOM fallbacks — nothing to thread here.
import { renderMarkdownLite, extractPartnerHandoff } from "@/lib/atlas/markdown-lite";
import PartnerHandoffCard from "./PartnerHandoffCard";

export default function AtlasProse({ text }: { text: string }) {
  const { text: prose, handoff } = extractPartnerHandoff(text);
  return (
    <>
      {prose && <span dangerouslySetInnerHTML={{ __html: renderMarkdownLite(prose) }} />}
      {handoff && <PartnerHandoffCard handoff={handoff} />}
    </>
  );
}
```

In `src/components/AssistantChat.tsx`:
1. Replace the import `import { renderMarkdownLite } from "@/lib/atlas/markdown-lite";` with `import AtlasProse from "./atlas/AtlasProse";`
2. Replace ALL FOUR render sites (two `summary` sites, two `part.text` sites — grep `renderMarkdownLite(`):
   - `<span dangerouslySetInnerHTML={{ __html: renderMarkdownLite(summary) }} />` → `<AtlasProse text={summary} />` (×2; keep each site's surrounding conditional `summary ? (…) : null`).
   - ```tsx
                             return (
                               <span
                                 key={i}
                                 dangerouslySetInnerHTML={{
                                   __html: renderMarkdownLite(part.text || ""),
                                 }}
                               />
                             );
     ```
     → 
     ```tsx
                             return <AtlasProse key={i} text={part.text || ""} />;
     ```
     (×2 — desktop and modal-mode message loops; indentation differs per site).
   Wait for zero remaining matches: `grep -n "renderMarkdownLite" src/components/AssistantChat.tsx` must print nothing.
3. Note: `AtlasProse` returns a fragment, so `key` moves onto `<AtlasProse key={i} …/>` at the two list-rendered sites.

In `src/lib/help-content.ts`, `planner-itinerary` section: replace the phrase `partner search link` with `partner search button` in EVERY entry that contains it — after Task 7 that is three: `"Auto-search"` (text written by Task 7), `"Adding items"` (pre-existing — review NIT-2), and `"Atlas chat"`. One word each — the handoff now renders as a card/button. Verify: `grep -c "partner search link" src/lib/help-content.ts` → `0`.

- [ ] **Step 4: Run tests + lint + build to verify**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: all green (full unit suite — the no-fabrication tripwires from Task 7 must still pass against the edited AssistantChat).

- [ ] **Step 5: Commit**

```bash
git add src/lib/atlas/markdown-lite.ts src/lib/atlas/markdown-lite.test.ts src/components/atlas/PartnerHandoffCard.tsx src/components/atlas/PartnerHandoffCard.test.tsx src/components/atlas/AtlasProse.tsx src/components/AssistantChat.tsx src/lib/help-content.ts
git commit -m "feat(monetization): promote Atlas prose partner handoffs to PartnerHandoffCard CTAs"
```

---

### Task 9: AirAdvisor flag-off — strip every non-earning render/prompt site

**Files:**
- Modify: `src/lib/atlas/system-prompt.ts` (delete the rule line at line 113)
- Modify: `src/components/AffiliateRecommendations.tsx` (delete the AirAdvisor rec block at lines 122–140)
- Test: `src/lib/atlas/system-prompt.test.ts` (extend)

**Interfaces:**
- The registry side is already done (Task 2: `airadvisor_cj.enabled === false`, `buildUrl() === ""`, `hosts: []`). This task removes the two remaining raw-URL surfaces so AirAdvisor sends zero non-earning traffic (spec success criterion 6). `CJ_LINKS.airAdvisor` stays in `affiliates.ts` (with its TODO comment) — turning the program back on later is: paste the CJ click URL into `CJ_LINKS.airAdvisor`, point `airadvisor_cj.buildUrl` at it, add its CJ host to `hosts`, flip `enabled:true` (O1).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/atlas/system-prompt.test.ts`:

```typescript
  it("never mentions AirAdvisor while the program has no earning URL (Phase 3 task 6)", () => {
    const prompt = buildAtlasSystemPrompt({ pageContext: "Active trip to Miami, Florida" });
    expect(prompt).not.toMatch(/airadvisor/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/atlas/system-prompt.test.ts`
Expected: FAIL — the prompt currently contains the AirAdvisor rule line.

- [ ] **Step 3: Implement**

In `src/lib/atlas/system-prompt.ts`, delete the single rule line:

```
- For flights that were delayed or cancelled, mention AirAdvisor at https://airadvisor.com/en/flight-compensation as a way to claim compensation
```

In `src/components/AffiliateRecommendations.tsx`, delete the whole AirAdvisor block (anchor: the comment `// AirAdvisor — flight compensation (CJ ID 7818110, click URL pending)` through the closing `}` of `if (wantsFlightHelp) { … }`, i.e. the `wantsFlightHelp` computation AND the `recs.push({ id: "air-advisor", … })` block). Do NOT remove the `"flight_compensation"` member from the `Recommendation` interface's `category` union (previously-added itinerary items may still carry it) and do NOT edit locale message files (the now-unused `airAdvisorTitle`/`airAdvisorDesc` keys are harmless).

- [ ] **Step 4: Run tests to verify**

Run: `npm run test:unit -- src/lib/atlas/system-prompt.test.ts && npm run lint`
Expected: PASS; lint clean.

Run: `grep -rni "airadvisor" src/ --include="*.tsx" | grep -v "\.test\." ; grep -rni "airadvisor" src/lib/atlas/ | grep -v "\.test\."`
Expected: NO output from either. (The only remaining mentions live in `src/config/affiliates.ts` comments/builder and in `.test.` files' disabled-partner cases — `affiliates.test.ts`, `AffiliateLink.test.tsx`, the opener/route tests, the system-prompt guard test's own name — all config/test code, non-rendering. The `.test.` exclusion exists because Task 3's tests legitimately exercise the disabled `airadvisor_cj` id.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/atlas/system-prompt.ts src/lib/atlas/system-prompt.test.ts src/components/AffiliateRecommendations.tsx
git commit -m "feat(monetization): flag AirAdvisor off — no non-earning traffic until CJ URL approved (O1)"
```

---

### Task 10: Full executor gate

**Files:** none (verification only)

- [ ] **Step 1: Full executor gate**

Run: `npm run lint && npm run test:unit && npm run build`
Expected: all green. (Do NOT run `npm run test` / `npm run test:e2e` — Playwright needs a live server on :3001 and runs in the main session's phase, Task 11.) If anything fails, stop and report the exact output — do not patch beyond this plan.

- [ ] **Step 2: Grep guards**

Run each and compare against the expected output exactly:

```bash
grep -rn "search_hotels\|search_activities\|search_restaurants" src/ | grep -v "no-fabrication.test"
# Expected: no output

grep -rn "p=4001" src/ | grep -v "\.test\."
# Expected: no output — the only allowed mention is affiliates.test.ts's own
# not.toContain("p=4001") assertion; production code never carries the token
# (the affiliates.ts registry comment references the incident without it).

grep -rn "HotelResult\|ActivityResult\|RestaurantResult" src/ | grep -v "no-fabrication.test"
# Expected: no output

grep -rn 'rel="noopener noreferrer"' src --include="*.tsx"
# Expected: no output — every former plain-noopener anchor was migrated (AffiliateLink),
# deleted (HotelCard + modal hotel tab), moved to markdown-lite.ts (a .ts file), or made
# a JSX ternary (TripModes). Any hit is a missed rel gap.

ls src/components/atlas/HotelCard.tsx src/components/atlas/ActivityCard.tsx src/components/atlas/RestaurantCard.tsx 2>&1
# Expected: three "No such file or directory" errors

grep -rn "airadvisor" src --include="*.tsx" | grep -v "\.test\."
# Expected: no output — AffiliateLink.test.tsx's disabled-partner case is the
# only allowed *.tsx mention.
```

- [ ] **Step 3: Report**

Report the full gate + grep output verbatim to the orchestrator. Do NOT push or open a PR — branch completion is handled by the main session after Fable verification and the live smoke (Task 11).

---

### Task 11: Main-session verification, STOP gate, deploy, rollback

**Executed by the MAIN SESSION (not a Hermes executor).** Requires: all Tasks 1–10 committed on `feat/phase3-monetization-loop`; **Phase 2 deployed and live on the VPS** (hard precondition — if Phase 2 is not live yet, stop after Step 3 and park the branch).

- [ ] **Step 1: E2E suite against a local server**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/tpi-phase3-monetization
npm ci   # only if node_modules is stale
npm run dev -- -p 3001   # run in background; wait for "Ready"
npm run test:e2e
```

Expected: all Playwright specs pass (`tests/e2e/` — `guest-flow.spec.ts`, `planner-trust.spec.ts`, `trip-api-dto.spec.ts`, `visual-baseline.spec.ts`, plus the `.test.js` suites). `visual-baseline.spec.ts` snapshots MAY legitimately change where the modal/chat surfaces changed — if snapshot diffs appear, review each image, confirm it matches this plan's intended UI change, then update snapshots (`npx playwright test tests/e2e/visual-baseline.spec.ts --update-snapshots`) and re-run. Any non-snapshot failure: stop and investigate — do not update snapshots to silence a real regression.

- [ ] **Step 2: Local guest-journey smoke (evidence required)**

With the dev server still running, drive the loop end-to-end (Playwright MCP or browser):
1. Guest → open a guide → planner → create a trip (e.g. Miami, 2 adults, mid budget).
2. Consent to Atlas → ask: `"Find me a hotel for this trip"`.
3. **Verify:** the reply is prose guidance + a `PartnerHandoffCard` (styled button labeled like `Search hotels in Miami on Hotels.com`), with NO invented hotel names/ratings/prices anywhere; the card's anchor has `rel` containing `sponsored`, `noopener`, `noreferrer` and an `https://www.dpbolvw.net/…` href.
4. Click the card. Then:
   ```bash
   sqlite3 data/tpi.db "SELECT partner_id, trip_id, session_id, created_at FROM affiliate_click ORDER BY id DESC LIMIT 5;"
   ```
   **Expected:** a `hotels_cj` row with a non-null `session_id` (and `trip_id` when clicked from a trip page).
5. Ask for flights (e.g. `"flights MIA to CUN in September"`) → a `FlightCard` renders → click "Book on Aviasales" → a second `affiliate_click` row appears with `partner_id = aviasales`.
6. Ask `"good restaurants near the hotel?"` → prose + a Google Maps link rendered as a plain link (NOT a card, NOT `sponsored`).

Capture all command output + a screenshot of the handoff card as evidence.

- [ ] **Step 3: Branch completion (before any deploy)**

Follow `superpowers:finishing-a-development-branch`: push the branch, open a PR to `main`, run the post-implementation review loop (Fable review per `feedback_code_review_after_plan`), fix findings, merge only when review + gates are green. **Merging to main does NOT authorize deploying.**

- [ ] **Step 4: HARD STOP GATE — Jose's explicit go-ahead required**

**STOP. Do not run any command against the VPS beyond the read-only SHA capture below.** Present to Jose: the Task 10 gate output, the Step 1–2 evidence (screenshots + `affiliate_click` rows), the click-metric scope statement from the Goal (which surfaces count vs. rel-only; the counter is a floor — review MEDIUM-1), and the O4 open item (Tiqets/Kiwi/Kiwitaxi — disabled unless the optional Task 4b obtained their ids from the TP API; any still-disabled partner needs Jose's dashboard-generated ids to go live). Per CLAUDE.md: NEVER deploy without visual review and explicit approval. Only proceed past this line on Jose's explicit "deploy" instruction.

- [ ] **Step 5: Record the rollback point, then deploy**

```bash
# Record the rollback SHA FIRST (read-only):
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git log --oneline -1"
# → save this as ROLLBACK_SHA in the session notes

# Deploy (after explicit approval only):
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git pull && bash scripts/deploy-vps.sh"
```

`scripts/deploy-vps.sh` runs `npm ci`, `npm run build`, and `pm2 reload/start` for the `tpi` process (port 3001 behind the web server). The `affiliate_click` table is created automatically on first `getDb()` call — no manual migration.

- [ ] **Step 6: Post-deploy production smoke**

```bash
curl -sI https://travelplaninfo.com | head -3                      # 200
curl -s https://travelplaninfo.com/api/assistant/health | jq .    # healthy:true
BASE_URL=https://travelplaninfo.com npx playwright test tests/e2e/planner-trust.spec.ts
```

Then repeat the Step 2 guest journey against `https://travelplaninfo.com` (this is spec task 8 — the workstation-independent live smoke), and verify the click row on the VPS:

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "sqlite3 /home/travelplaninfo/nextjs/data/tpi.db \"SELECT partner_id, trip_id, session_id, created_at FROM affiliate_click ORDER BY id DESC LIMIT 5;\""
```

Expected: the production click(s) you just made, keyed by partner + session/trip. Capture all output as evidence.

**Metric/data hygiene (review NIT-5):** this smoke seeds production with test data — record the created trip ids and the new `affiliate_click` rowids in the session notes so Phase 2A analytics can start from a clean baseline (or delete the smoke rows right after the evidence is captured). Keep the CJ/TP self-clicks to this one-off QA pass — habitual self-clicking violates network ToS.

- [ ] **Step 7 (pre-written ROLLBACK — run only if Step 6 fails)**

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git reset --hard <ROLLBACK_SHA> && npm ci && npm run build && pm2 restart tpi && pm2 status tpi"
curl -sI https://travelplaninfo.com | head -3   # confirm 200 on the rolled-back build
```

Rollback safety properties (why this is safe mid-flight):
- **DB:** the only schema change is the additive `affiliate_click` table — the old build ignores it; no schema rollback needed, no data loss.
- **Config:** the `PARTNERS` registry is additive; every pre-existing surface still reads `CJ_LINKS`/`TP_*` directly, so the rolled-back build renders exactly the pre-Phase-3 links.
- **No new env vars** are introduced by this phase — nothing to unset.
After any rollback: report the failure evidence to Jose, revert or fix on the branch, and re-enter this task at Step 1.

---

## Plan-author notes

Candid gaps, decisions, and risks for the adversarial reviewer:

1. **O4 (biggest open item): Tiqets/Kiwi.com/Kiwitaxi Travelpayouts ids are NOT determinable from the repo or credentials.** A full sweep found only Klook's ids (`campaign_id=137`, `p=4110`, in both `affiliates.ts:47` and `command-post/tp_client.py:315`); `~/.openclaw/credentials/travelpayouts.json` confirms marker `164743` and TPI site id `500721` (= `trs`) but contains no per-program campaign ids, and `command-post/generate_tp_links.py` fetches links from the TP API rather than embedding an id table. Per the never-invent rule (and the burned `p=4001` incident) the plan ships these three partners as registry entries with `TP_PROGRAM_IDS = null` + `enabled:false` + `buildUrl → ""`. **This satisfies spec success criterion 1 (registry contains them) but NOT a stronger reading where their links are live.** Jose must generate the three links in the TP dashboard; go-live is then a paste + one-line flip each. The `u=` landing targets I wrote (tiqets search URL, kiwi/kiwitaxi homepages) are also placeholders to re-check at flip time. If the reviewer prefers, the ids could alternatively be fetched via `generate_tp_links.py` against the TP API before implementation — I did not run it (plan-author role is read-only). **[Review 2026-07-07, HIGH-2: adopted — optional Task 4b now lets the MAIN session fetch these ids from the TP API and flip the partners live; spec §3.1 + success criterion 1 state the registered-but-disabled definition of done.]**
2. **Modal trigger becomes unreachable after Task 7.** `countTripTools >= 2` can never fire with `TRIP_TOOLS = {search_flights}` alone, so the "View Full Plan" button and the stripped-down `TripResultsModal` are dead UI in practice (they already were under the 4-tool brain — the modal only opened on multi-tool responses, which no longer occur). The spec said "remove/neutralize the latent fabrication shapes", not "delete the modal", so I kept the machinery with an explanatory comment. A reviewer could reasonably argue for deleting `TripResultsModal` + the trigger entirely (more code removed) or for firing the modal on flights alone (behavior change). I chose the smallest-diff reading of the spec; flag if you disagree.
3. **Click-attribution design (resolves spec O3).** `chat_sessions.id` (TEXT uuid, stored client-side as `sessionStorage["atlas_session_id"]`) and `trips.id` (INTEGER, exposed in the `#atlas-trip-context` script tag) are different id spaces; `affiliate_click` stores both, nullable. Rather than threading props through every card, `logAffiliateClick` reads both from the DOM as fallbacks — so FlightCard/DealCard/PartnerHandoffCard clicks all get attribution when made on a trip page with a chat session, and degrade to partner-only elsewhere. Known coverage gaps I accepted: (a) inline prose affiliate links that are NOT the trailing handoff (rare — Atlas is instructed to emit exactly one trailing link) get `rel="sponsored"` but no click logging, since they live inside `dangerouslySetInnerHTML`; (b) the planner sidebar (`AffiliateRecommendations`/`AffiliatePreviewModal`) and static pages (`hot-deals`, banners) are already rel-compliant and were NOT migrated onto `AffiliateLink`, so their clicks are not counted in this phase — spec §5 says migrate opportunistically only where task 5 requires. The measurable-loop success criterion is satisfied by the handoff card + flight/deal cards. **[Review 2026-07-07, MEDIUM-1: gaps promoted to the success-criteria level — see the Goal's click-metric scope statement and spec success criterion 5. (c) The TripModes CJ cruise links get `rel` via Task 6's ternary but are deliberately NOT migrated onto `AffiliateLink` (accepted-gap note in Task 6); middle-click/context-menu opens bypass `onClick` on every migrated anchor, so the counter is a floor, not a census.]**
4. **`/api/affiliate/click` is unauthenticated and un-rate-limited.** Deliberate (guest clicks must count; `sendBeacon` can't carry custom auth), validated against the PARTNERS registry so only known partner ids insert. A bot could inflate counts. I judged this acceptable for an internal metric at TPI's traffic level; if the reviewer disagrees, the cheap hardening is reusing the chat route's in-memory per-IP rate-limit pattern. **[Review 2026-07-07, HIGH-1: adjudicated must-fix and applied — Task 3 now ships `Object.hasOwn` validation (the original `in` check accepted prototype keys like `"toString"`), disabled-partner rejection, and the per-IP in-memory rate limit that answers `{ ok: true }` on throttle, all pinned by route unit tests.]**
5. **`rel` ordering is asserted by token, not string.** The codebase has both `"noopener noreferrer sponsored"` (existing surfaces) and the new `"sponsored noopener noreferrer"` (spec wording, used by `AffiliateLink`/markdown-lite). Semantically identical; tests split on whitespace. The Task 10 grep guard therefore only catches the exact plain `rel="noopener noreferrer"` literal — a hand-rolled future anchor with a novel rel string would evade it; the real guard is "always use AffiliateLink".
6. **TripModes host classification decision:** CJ cruise deep links in `src/content/tripModes.ts` become `sponsored`; links to Jose's own transport sites (airportspickup.com, 123corporatetransportation.com) deliberately do NOT — they are first-party lead-gen cross-links, not paid placements. If Jose considers them disclosure-worthy, add those hosts to a partner entry later.
7. **AtlasProse streaming nuance:** while a reply is still streaming, a partially-received trailing handoff line renders as plain text and "snaps" into the card once the closing `)` arrives — same progressive behavior links have today. The two `summary` render sites also route through `AtlasProse` for consistency even though the multi-tool path that renders summaries is currently unreachable (see note 2).
8. **First component tests in the repo.** Tasks 3/6/8 introduce the repo's first `.test.tsx` files. `vitest.config.ts` (jsdom, globals, `@vitejs/plugin-react`, `src/**/*.test.{ts,tsx}` include) and the installed `@testing-library/react`/`jsdom` support this without config changes — verified against the config, not executed. If `render()` fails on some environment detail, that's an execution-time discovery; the fix belongs in vitest config, not in the components.
9. **The file-content tripwires in `no-fabrication.test.ts` are string-greps, not semantics.** E.g. `types.ts` must not contain the token `rating` — fine today (FlightResult has no rating field) but a legitimate future field named e.g. `operating_days` would pass while `rating_note` would false-positive. I kept the token lists minimal and file-scoped to limit false positives; they are tripwires, not proofs. **[Review 2026-07-07, NIT-3: the `operating_days` example above was itself wrong — the bare substring `rating` DOES match "operating"; the types.ts tripwire now asserts word-bounded `/\brating\b/` instead. BLOCKER-1 also lived here: the plan's own Task 7 comments originally contained tripwire tokens — both comments are now token-free.]**
10. **`buildAutoSearchPrompt` (AssistantChat ~line 500) still says "Search flights, hotels, and activities for me."** — left untouched deliberately: the Phase-2 brain answers the hotel/activity parts with honest prose + handoff (which Task 8 turns into a card), so the prompt is not a fabrication vector and changing it would alter auto-search UX outside this spec.
11. **E2E snapshot risk:** `visual-baseline.spec.ts` may diff on the chat/modal surfaces changed here; Task 11 Step 1 includes an explicit review-then-update-snapshots procedure so a real regression can't be silenced mechanically. I could not pre-verify which snapshots cover these surfaces (did not run Playwright as plan author).
12. **Line-number drift:** anchors were verified at `4d5a1e7`, but Tasks 5–8 all touch `AssistantChat.tsx` sequentially, so later tasks MUST locate anchors by quoted text, not by the line hints. This is called out in Global Constraints; repeated here because it is the likeliest mechanical failure mode for a fresh-context executor.
13. **Help-content updates** (Tasks 7/8) implement the standing `feedback_update_help_with_features` rule for the user-visible changes (modal tabs removed, handoff card added). Locale `messages/*.json` were deliberately not touched — the help content lives in `src/lib/help-content.ts` (English-only), and removed recommendation strings merely become unused keys.
14. **`dangerouslySetInnerHTML` / XSS posture (flagged by the security hook):** `AtlasProse` keeps the codebase's existing pattern — LLM text passes through `escapeHtml()` FIRST, then markup is built from the escaped string, and the link regexes only admit `https?://` or `/`-relative hrefs (blocking `javascript:` and attribute breakout, since quotes are already `&quot;`-escaped). Task 5 moves this code verbatim and its test suite pins the guard (`<script>` never survives). No sanitizer library is introduced because the input is escaped before any HTML exists — the reviewer should confirm they accept escape-first over a DOMPurify-style sanitize-after approach, which would be a larger, out-of-spec change to a pre-existing mechanism.
