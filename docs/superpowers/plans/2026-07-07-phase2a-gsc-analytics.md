# Phase 2A — GSC + First-Party Analytics Implementation Plan

> **For agentic workers:** This plan is executed task-by-task by GPT-5.5 dispatched via the Hermes CLI (`hermes -z "<prompt>" -m gpt-5.5 --cli --yolo`), orchestrated by an Opus 4.8 agent, from a fresh context with no memory of prior conversation. REQUIRED SUB-SKILL for the orchestrator: superpowers:subagent-driven-development (or superpowers:executing-plans for inline execution). Read the entire task you are assigned before starting. Do not skip verification steps. If a verification command fails, stop and report — do not guess a fix that isn't in this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Google Search Console verification and a cookieless, first-party, server-side analytics layer that captures the 7 guide→planner→Atlas→itinerary→affiliate funnel events and makes affiliate-clicks-per-trip-session queryable — with zero third-party client scripts and zero analytics cookies (spec: `docs/superpowers/specs/2026-07-07-phase2a-gsc-analytics-design.md`).

**Architecture:** A new `events` table in the existing `data/tpi.db` (via the `src/lib/db.ts` migration pattern) fed two ways: client-only impressions post a JSON string to a new best-effort `POST /api/event` route via a tiny `navigator.sendBeacon` helper (`track()`), while server-known events (`trip_created`) are written directly at the API route that already handles them — and are **rejected** at the public ingest (client-postable allowlist), so they cannot be forged from outside. The ingest is rate-limited per IP (in-memory Map, 60/min — the `src/app/api/assistant/chat/route.ts:12-33` pattern; throttled beacons are dropped with 204). Session identity is resolved **server-side** from the existing httpOnly `tpi_guest` cookie / auth session — the client never reads, sets, or sends any identifier. GSC ownership is an env-driven `metadata.verification.google` entry in the real layout (`src/app/[locale]/layout.tsx`); `sitemap.ts`/`robots.ts` already exist and are correct. A read-side reporting lib + token-gated `GET /api/analytics/summary` proves the funnel and the MVP metric are queryable; Phase 3's `affiliate_click` table stays the canonical click store and reports `null` until it ships.

**Tech Stack:** Next.js 16 App Router, TypeScript, `better-sqlite3` (via `src/lib/db.ts`), Vitest (jsdom + `@testing-library/react`), Playwright.

## Global Constraints

- **Worktree:** work in `/home/jarvis/.openclaw/workspace/jarvis-project/tpi-phase2a-analytics` on branch `feat/phase2a-gsc-analytics` (created from `main` @ `4d5a1e7` via `superpowers:using-git-worktrees` at execution start). All paths below are relative to that root.
- **Dependencies:** if `node_modules` is absent in the worktree, run `npm ci` once before any test step.
- **Test command:** `npm run test` runs unit + e2e. For a single file ALWAYS use `npm run test:unit -- <path>` (the `test:unit` script is `vitest run`). NEVER `npm run test -- <path>` — the extra arg is forwarded to the e2e runner.
- **E2E:** the Playwright suite expects a server already running at `http://localhost:3001` (`npm run dev -- --port 3001`) — executors never run `npm run test` or `npm run test:e2e`; the branch gate for executors is `npm run lint && npm run test:unit && npm run build` (Task 10). E2E runs in the main session's live-smoke phase (Task 11).
- **HARD ACCEPTANCE (IMPLEMENTATION_PLAN.md:154): no third-party client script, no analytics cookie.** Never add `next/script`, GA/gtag, Plausible, Umami, PostHog, or any external analytics loader. `POST /api/event` must resolve the caller with `getUserId()` from `src/lib/guest.ts` (read-only) — **NEVER `getOrCreateGuest()`**, which sets cookies and would violate the cookieless acceptance.
- **Canonical event names (7):** `guide_view`, `planner_start`, `trip_created`, `atlas_health_hidden`, `atlas_consent`, `tool_result_rendered`, `affiliate_click`. Two allowlists, two tiers: the `events`-table allowlist (`ALLOWED_EVENT_TYPES`) contains the first **6**; the public-ingest allowlist (`CLIENT_EVENT_TYPES`) contains only the **5** client-beacon events — `trip_created` is server-side only and MUST be rejected by `POST /api/event` (review HIGH-2: it feeds the MVP metric's denominator and must not be spoofable). `affiliate_click`'s canonical store is Phase 3's dedicated `affiliate_click` table (fed by Phase 3's `POST /api/affiliate/click`); Phase 2A only **consumes** that table in reporting (soft-gate: report `null` while it doesn't exist). Never add an `affiliate_click` writer in this plan.
- **Cross-phase `db.ts` anchor (shared with Phase 3 — review MEDIUM-5):** this plan and `2026-07-07-phase3-monetization-loop.md` both append an idempotent `CREATE TABLE IF NOT EXISTS` migration directly after the `assistant_cost` block, and both edit `AssistantChat.tsx`. NEVER run the two plans in the same worktree. If Phase 3 lands first (or vice versa), rebase before executing: whichever plan executes second MUST re-read the then-current `src/lib/db.ts` and insert after the **newest** migration block (the anchor is the quoted text, not a hardcoded line number) — merge order is irrelevant because both migrations are `CREATE TABLE IF NOT EXISTS`. The `AssistantChat.tsx` anchors below are text-based and do not overlap Phase 3's edit sites.
- **Best-effort contract:** `recordEvent()` and `track()` NEVER throw; an analytics failure must never block or break a user-facing request. `POST /api/event` returns 204 even when the DB write fails.
- **Test isolation:** unit tests must NEVER touch the real `data/tpi.db`. Mock `@/lib/db` with an in-memory `better-sqlite3` database, exactly like `src/lib/atlas/spend.test.ts` does.
- **New env vars:** `GOOGLE_SITE_VERIFICATION` (GSC token, read at build/render time; absent → no meta tag) and `ANALYTICS_SUMMARY_TOKEN` (server secret via `src/lib/server-config.ts`; absent → summary endpoint fail-closed 404). Both get `.env.example` entries.
- **Do not touch:** the Atlas brain (`src/lib/atlas/*` logic, `system-prompt.ts`, `tool-loop.ts`, `travelpayouts-client.ts`) except the two named insertion points in `src/components/AssistantChat.tsx` and `src/hooks/useAssistantHealth.ts`; `command-post/` Python; `content/articles/`; `src/config/affiliates.ts` (Phase 3 owns it); i18n/locale plumbing; anything not named in a task.
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit. One commit per task.

---

### Task 1: `events` table migration + analytics core lib (allowlist + PII guard)

**Files:**
- Modify: `src/lib/db.ts` (insert a new migration block directly after the `assistant_cost` migration `_db.exec(...)` block — the one that creates `idx_assistant_cost_date`, currently lines 117-130 — and before the `// Migration: map feature columns on trip_items` comment)
- Create: `src/lib/analytics/events.ts`
- Test: `src/lib/analytics/events.test.ts`

**Interfaces:**
- Produces: `ALLOWED_EVENT_TYPES` (readonly tuple of the 6 events-table types), `CLIENT_EVENT_TYPES` (readonly tuple of the 5 client-postable types — `ALLOWED_EVENT_TYPES` minus the server-only `trip_created`; review HIGH-2), `AllowedEventType`, `RecordEventResult = "stored" | "rejected" | "error"`, `EventInput { eventType: string; sessionId?: string | null; tripId?: number | null; path?: string | null; meta?: Record<string, unknown> }`, `recordEvent(input: EventInput): RecordEventResult` (never throws), `validateMeta(meta: Record<string, unknown>): string | null` (null = safe). `path` is validated at the same choke point as `meta` (review MEDIUM-1): must match `/^\/[^\s]*$/` and pass the same email/long-digit-run PII regexes, else the event is rejected.
- Consumed by: Task 2 (`/api/event` route — checks `CLIENT_EVENT_TYPES` before `recordEvent`), Task 6 (`/api/trips` capture), Task 9 (reporting imports `ALLOWED_EVENT_TYPES`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/analytics/events.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// In-memory DB — never touches the real data/tpi.db (repo test convention,
// see src/lib/atlas/spend.test.ts). Mirrors the events schema added to
// src/lib/db.ts in this task.
let memDb: Database.Database;
vi.mock("@/lib/db", () => ({
  getDb: () => memDb,
}));

import { recordEvent, validateMeta, ALLOWED_EVENT_TYPES, CLIENT_EVENT_TYPES } from "./events";

function allEvents() {
  return memDb.prepare("SELECT * FROM events ORDER BY id").all() as Array<{
    event_type: string;
    trip_id: number | null;
    session_id: string | null;
    path: string | null;
    meta_json: string;
  }>;
}

describe("analytics events core", () => {
  beforeEach(() => {
    memDb = new Database(":memory:");
    memDb.exec(`
      CREATE TABLE events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        trip_id    INTEGER,
        session_id TEXT,
        path       TEXT,
        meta_json  TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  it("stores an allowed event with session, trip, path and meta", () => {
    const result = recordEvent({
      eventType: "guide_view",
      sessionId: "42",
      tripId: 7,
      path: "/guides",
      meta: { slug: "miami-3-days" },
    });
    expect(result).toBe("stored");
    const rows = allEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "guide_view",
      trip_id: 7,
      session_id: "42",
      path: "/guides",
    });
    expect(JSON.parse(rows[0].meta_json)).toEqual({ slug: "miami-3-days" });
  });

  it("stores with null session/trip/path when omitted (fresh anonymous visitor)", () => {
    expect(recordEvent({ eventType: "guide_view" })).toBe("stored");
    expect(allEvents()[0]).toMatchObject({
      trip_id: null,
      session_id: null,
      path: null,
      meta_json: "{}",
    });
  });

  it("rejects event types outside the allowlist — including affiliate_click (Phase 3's table is canonical)", () => {
    expect(recordEvent({ eventType: "affiliate_click" })).toBe("rejected");
    expect(recordEvent({ eventType: "hax" })).toBe("rejected");
    expect(recordEvent({ eventType: "" })).toBe("rejected");
    expect(allEvents()).toHaveLength(0);
  });

  it("rejects meta containing an email-shaped value (PII guard)", () => {
    expect(
      recordEvent({ eventType: "guide_view", meta: { note: "reach me at jose@example.com" } })
    ).toBe("rejected");
    expect(allEvents()).toHaveLength(0);
  });

  it("rejects meta containing a long digit run (phone/id guard)", () => {
    expect(recordEvent({ eventType: "guide_view", meta: { note: "call 3055551234" } })).toBe(
      "rejected"
    );
    expect(allEvents()).toHaveLength(0);
  });

  it("rejects structurally unsafe meta (bad keys, non-scalars, oversized, too many keys, reserved keys)", () => {
    expect(validateMeta({ "Bad Key": 1 })).not.toBeNull();
    expect(validateMeta({ nested: { a: 1 } as unknown as string })).not.toBeNull();
    expect(validateMeta({ long: "x".repeat(201) })).not.toBeNull();
    expect(
      validateMeta(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 1])))
    ).not.toBeNull();
    expect(validateMeta(JSON.parse('{"__proto__": 1}') as Record<string, unknown>)).not.toBeNull();
    expect(validateMeta({ slug: "miami", n: 3, ok: true })).toBeNull();
  });

  it("rejects a path that is not a same-site pathname or that carries PII (review MEDIUM-1)", () => {
    expect(recordEvent({ eventType: "guide_view", path: "https://evil.example/x" })).toBe("rejected");
    expect(recordEvent({ eventType: "guide_view", path: "/u/jose@example.com" })).toBe("rejected");
    expect(recordEvent({ eventType: "guide_view", path: "/call-3055551234" })).toBe("rejected");
    expect(allEvents()).toHaveLength(0);
  });

  it("returns 'error' instead of throwing when the DB write fails (best-effort contract)", () => {
    memDb.exec("DROP TABLE events");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(recordEvent({ eventType: "guide_view" })).toBe("error");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("exposes exactly the 6 events-table types (affiliate_click lives in Phase 3's table)", () => {
    expect([...ALLOWED_EVENT_TYPES]).toEqual([
      "guide_view",
      "planner_start",
      "trip_created",
      "atlas_health_hidden",
      "atlas_consent",
      "tool_result_rendered",
    ]);
  });

  it("exposes exactly the 5 client-postable types — trip_created is server-side only (review HIGH-2)", () => {
    expect([...CLIENT_EVENT_TYPES]).toEqual([
      "guide_view",
      "planner_start",
      "atlas_health_hidden",
      "atlas_consent",
      "tool_result_rendered",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/analytics/events.test.ts`
Expected: FAIL — module `./events` does not exist.

- [ ] **Step 3: Add the migration to `src/lib/db.ts` and implement `src/lib/analytics/events.ts`**

In `src/lib/db.ts`, directly after the `assistant_cost` migration block (the `_db.exec` that ends with `CREATE INDEX IF NOT EXISTS idx_assistant_cost_date ON assistant_cost(date);` and its closing backtick + `);`), and before the `// Migration: map feature columns on trip_items` comment, insert:

```typescript
  // Migration: first-party analytics events table (Phase 2A)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      trip_id    INTEGER,
      session_id TEXT,
      path       TEXT,
      meta_json  TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  `);
```

Create `src/lib/analytics/events.ts`:

```typescript
// src/lib/analytics/events.ts
// First-party, cookieless analytics core (server-side consumers only).
// Best-effort by contract: recordEvent NEVER throws — a failed analytics
// write must never break a user-facing request.
import { getDb } from "@/lib/db";

// 6 of the 7 funnel events (IMPLEMENTATION_PLAN.md:147). `affiliate_click`
// is deliberately NOT here: its canonical store is Phase 3's dedicated
// affiliate_click table (fed by POST /api/affiliate/click). Phase 2A only
// consumes that table in reporting.
export const ALLOWED_EVENT_TYPES = [
  "guide_view",
  "planner_start",
  "trip_created",
  "atlas_health_hidden",
  "atlas_consent",
  "tool_result_rendered",
] as const;

// The subset a browser may POST to the public ingest. trip_created is
// deliberately NOT here: it is written server-side at POST /api/trips and
// feeds the MVP metric's denominator — accepting it from clients would make
// the "unspoofable" server-side event spoofable (review HIGH-2).
export const CLIENT_EVENT_TYPES = [
  "guide_view",
  "planner_start",
  "atlas_health_hidden",
  "atlas_consent",
  "tool_result_rendered",
] as const;

export type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number];

export type RecordEventResult = "stored" | "rejected" | "error";

export interface EventInput {
  eventType: string;
  sessionId?: string | null;
  tripId?: number | null;
  path?: string | null;
  meta?: Record<string, unknown>;
}

const MAX_META_KEYS = 8;
const MAX_STRING_VALUE_LENGTH = 200;
const MAX_META_JSON_LENGTH = 1000;
const MAX_PATH_LENGTH = 200;
const KEY_RE = /^[a-z0-9_]{1,32}$/;
const RESERVED_KEYS = ["__proto__", "constructor", "prototype"];
// path must look like window.location.pathname — same-site pathname, no spaces.
const PATH_RE = /^\/[^\s]*$/;
// PII guards: no email-shaped strings, no long digit runs (phone numbers).
const EMAIL_RE = /[^\s@"']+@[^\s@"']+\.[^\s@"']{2,}/;
const LONG_DIGIT_RUN_RE = /\d{7,}/;

// path is client-controlled free text — run it through the same PII choke
// point as meta values (review MEDIUM-1). Returns null when safe.
function validatePath(path: string): string | null {
  if (!PATH_RE.test(path)) return "path is not a same-site pathname";
  if (EMAIL_RE.test(path)) return "path looks like it contains an email";
  if (LONG_DIGIT_RUN_RE.test(path)) return "path contains a long digit run";
  return null;
}

// Returns null when meta is safe to store, else a short rejection reason.
export function validateMeta(meta: Record<string, unknown>): string | null {
  const keys = Object.keys(meta);
  if (keys.length > MAX_META_KEYS) return "too many meta keys";
  for (const key of keys) {
    if (RESERVED_KEYS.includes(key)) return `reserved meta key: ${key}`;
    if (!KEY_RE.test(key)) return `bad meta key: ${key}`;
    const value = meta[key];
    const type = typeof value;
    if (type !== "string" && type !== "number" && type !== "boolean") {
      return `non-scalar meta value: ${key}`;
    }
    if (type === "string") {
      const s = value as string;
      if (s.length > MAX_STRING_VALUE_LENGTH) return `oversized meta value: ${key}`;
      if (EMAIL_RE.test(s)) return `meta value looks like an email: ${key}`;
      if (LONG_DIGIT_RUN_RE.test(s)) return `meta value looks like a phone/id number: ${key}`;
    }
  }
  if (JSON.stringify(meta).length > MAX_META_JSON_LENGTH) return "meta too large";
  return null;
}

export function recordEvent(input: EventInput): RecordEventResult {
  if (!(ALLOWED_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    return "rejected";
  }
  const meta = input.meta ?? {};
  if (validateMeta(meta) !== null) return "rejected";
  const path = input.path ?? null;
  if (path !== null && validatePath(path) !== null) return "rejected";

  try {
    getDb()
      .prepare(
        `INSERT INTO events (event_type, trip_id, session_id, path, meta_json)
         VALUES (@eventType, @tripId, @sessionId, @path, @metaJson)`
      )
      .run({
        eventType: input.eventType,
        tripId: input.tripId ?? null,
        sessionId: input.sessionId ?? null,
        // Validated above; truncating a valid pathname cannot re-introduce PII.
        path: path ? path.slice(0, MAX_PATH_LENGTH) : null,
        metaJson: JSON.stringify(meta),
      });
    return "stored";
  } catch (error) {
    // Best-effort: analytics failures are logged, never propagated.
    console.error("recordEvent failed:", error);
    return "error";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/analytics/events.test.ts`
Expected: PASS (10/10)

- [ ] **Step 5: Run the full unit suite (db.ts changed — nothing may regress)**

Run: `npm run test:unit`
Expected: PASS (all pre-existing tests still green)

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/analytics/events.ts src/lib/analytics/events.test.ts
git commit -m "feat(analytics): events table migration + recordEvent core with allowlist and PII guard"
```

---

### Task 2: `POST /api/event` — cookieless best-effort ingest

**Files:**
- Create: `src/app/api/event/route.ts`
- Test: `src/app/api/event/route.test.ts`

**Interfaces:**
- Consumes: `recordEvent` + `CLIENT_EVENT_TYPES` from Task 1 (`@/lib/analytics/events`); `getUserId` from `src/lib/guest.ts` (existing — returns `{ userId, isGuest, guestToken? } | null`, read-only, never sets cookies).
- Produces: `POST /api/event` accepting a JSON body `{ event_type: string, trip_id?: number, path?: string, meta?: object }` posted as a **plain text string** (sendBeacon sends `text/plain` — the route parses `req.text()`, never `req.json()`). The route checks `event_type` against `CLIENT_EVENT_TYPES` **before** calling `recordEvent` — server-only types (`trip_created`) are rejected 400 at the public ingest (review HIGH-2). Responses: 204 stored, 204 on internal storage error (best-effort), 204-and-drop on rate limit, 400 on disallowed/server-only type / PII (in `meta` or `path`) / malformed / oversized body. Never sets a cookie. Already disallowed for crawlers by `src/app/robots.ts` (`disallow: '/api/'`) and excluded from the next-intl middleware matcher (`src/middleware.ts`).
- Rate limit (review HIGH-1, mirroring the Phase 3 click route's ruling for cross-thread consistency): in-memory Map keyed by the first `x-forwarded-for` hop (fallback `"local"`), fixed 60s window, **60 requests/min** (generous — a page mount fires at most one beacon), sweep interval for stale entries — the exact `src/app/api/assistant/chat/route.ts:12-33` pattern. A throttled request returns **204 and stores nothing** (never surface an error to a beacon — the analogue of Phase 3's `{ok:true}` ruling). A soft same-origin `Origin` check was reviewed as optional and is deliberately not built (matching Phase 3's posture; Task 11's curl evidence sends no Origin header) — revisit if bot noise appears.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/event/route.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// In-memory DB — never touches the real data/tpi.db.
let memDb: Database.Database;
vi.mock("@/lib/db", () => ({ getDb: () => memDb }));

// getUserId is mocked: the real one needs next/headers request scope.
const getUserIdMock = vi.fn();
vi.mock("@/lib/guest", () => ({
  getUserId: (...args: unknown[]) => getUserIdMock(...args),
}));

import { POST } from "./route";
import type { NextRequest } from "next/server";

function makeRequest(body: unknown, ip?: string): NextRequest {
  return new Request("http://localhost:3000/api/event", {
    method: "POST",
    // Default key is "local" (no header); rate-limit tests pass a dedicated ip
    // so their 60/min window can't collide with the other tests' requests.
    headers: ip ? { "x-forwarded-for": ip } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function allEvents() {
  return memDb.prepare("SELECT * FROM events ORDER BY id").all() as Array<{
    event_type: string;
    session_id: string | null;
    trip_id: number | null;
    path: string | null;
  }>;
}

describe("POST /api/event", () => {
  beforeEach(() => {
    memDb = new Database(":memory:");
    memDb.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        trip_id INTEGER,
        session_id TEXT,
        path TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    getUserIdMock.mockReset();
    getUserIdMock.mockResolvedValue({ userId: "42", isGuest: true, guestToken: "tok" });
  });

  it("stores an allowed event and returns 204 with no Set-Cookie", async () => {
    const res = await POST(
      makeRequest({ event_type: "guide_view", path: "/guides", meta: { slug: "miami" } })
    );
    expect(res.status).toBe(204);
    // Cookieless acceptance: the analytics ingest must never set a cookie.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(allEvents()).toMatchObject([
      { event_type: "guide_view", session_id: "42", path: "/guides" },
    ]);
  });

  it("stores with a null session for a fresh anonymous visitor (and never creates a guest)", async () => {
    getUserIdMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ event_type: "planner_start" }));
    expect(res.status).toBe(204);
    expect(allEvents()).toMatchObject([{ event_type: "planner_start", session_id: null }]);
  });

  it("rejects disallowed event types with 400 and stores nothing", async () => {
    const res = await POST(makeRequest({ event_type: "affiliate_click" }));
    expect(res.status).toBe(400);
    expect(allEvents()).toHaveLength(0);
  });

  it("rejects the server-only trip_created type with 400 — not spoofable via the public ingest (review HIGH-2)", async () => {
    const res = await POST(makeRequest({ event_type: "trip_created", trip_id: 7 }));
    expect(res.status).toBe(400);
    expect(allEvents()).toHaveLength(0);
  });

  it("rejects PII in meta with 400 and stores nothing", async () => {
    const res = await POST(makeRequest({ event_type: "guide_view", meta: { u: "a@b.com" } }));
    expect(res.status).toBe(400);
    expect(allEvents()).toHaveLength(0);
  });

  it("rejects a PII-bearing or non-pathname path with 400 (review MEDIUM-1)", async () => {
    expect((await POST(makeRequest({ event_type: "guide_view", path: "/u/jose@example.com" }))).status).toBe(400);
    expect((await POST(makeRequest({ event_type: "guide_view", path: "https://evil.example/x" }))).status).toBe(400);
    expect(allEvents()).toHaveLength(0);
  });

  it("rejects malformed JSON and oversized bodies with 400", async () => {
    expect((await POST(makeRequest("not json{{{"))).status).toBe(400);
    expect(
      (
        await POST(
          makeRequest({ event_type: "guide_view", meta: { s: "x".repeat(150) }, pad: "y".repeat(3000) })
        )
      ).status
    ).toBe(400);
    expect(allEvents()).toHaveLength(0);
  });

  it("ignores a non-integer trip_id instead of failing", async () => {
    const res = await POST(makeRequest({ event_type: "guide_view", trip_id: "7; DROP TABLE" }));
    expect(res.status).toBe(204);
    expect(allEvents()[0].trip_id).toBeNull();
  });

  it("returns 204 (not 5xx) when the DB write fails — best-effort contract", async () => {
    memDb.exec("DROP TABLE events");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeRequest({ event_type: "guide_view" }));
    expect(res.status).toBe(204);
    errorSpy.mockRestore();
  });

  it("survives getUserId throwing (session becomes null)", async () => {
    getUserIdMock.mockRejectedValue(new Error("no request scope"));
    const res = await POST(makeRequest({ event_type: "guide_view" }));
    expect(res.status).toBe(204);
    expect(allEvents()).toMatchObject([{ session_id: null }]);
  });

  it("rate limits per IP: the 61st request in a window is dropped — 204, nothing stored (review HIGH-1)", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await POST(makeRequest({ event_type: "guide_view" }, "203.0.113.9"))).status).toBe(204);
    }
    const res = await POST(makeRequest({ event_type: "guide_view" }, "203.0.113.9"));
    expect(res.status).toBe(204); // beacons never see an error
    expect(allEvents()).toHaveLength(60); // the 61st stored nothing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/app/api/event/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/event/route.ts
// Cookieless first-party analytics ingest. Best-effort by contract:
// - resolves the caller via getUserId() (READ-ONLY — never the guest-creating
//   helper, which SETS cookies and would violate the cookieless acceptance)
// - accepts only client-postable event types (server-only events like
//   trip_created are written at their owning route and rejected here)
// - rate-limited per IP; a throttled beacon is dropped with 204, never an error
// - never sets cookies, never blocks UX, returns 204 even on storage errors
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/guest";
import { recordEvent, CLIENT_EVENT_TYPES } from "@/lib/analytics/events";

const MAX_BODY_CHARS = 2048;

// ── Rate limiting (in-memory, per IP, 60 req/min) ───────────────────────────
// Same pattern as src/app/api/assistant/chat/route.ts:12-33 (and Phase 3's
// /api/affiliate/click at 30/min). 60/min is generous for real traffic — a
// page mount fires at most one beacon.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Clean up stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now >= entry.resetAt) rateLimitMap.delete(key);
  }
}, 60_000);

export async function POST(req: NextRequest) {
  // Throttle first (cheapest check). 204-and-drop: flooding must neither
  // error a beacon nor reach the single-writer SQLite event loop.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!checkRateLimit(ip)) {
    return new NextResponse(null, { status: 204 });
  }

  // Session resolution is read-only and optional — a brand-new visitor with
  // no cookie is still a countable (anonymous) event.
  let sessionId: string | null = null;
  try {
    const ctx = await getUserId();
    sessionId = ctx?.userId ?? null;
  } catch {
    sessionId = null;
  }

  // navigator.sendBeacon posts text/plain — parse raw text, not req.json().
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!raw || raw.length > MAX_BODY_CHARS) {
    return new NextResponse(null, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return new NextResponse(null, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Public-ingest allowlist (review HIGH-2): only the 5 client-beacon types.
  // Server-only events (trip_created) are written directly at their owning
  // API route — accepting them here would let any client forge the MVP
  // metric's denominator.
  const eventType = typeof body.event_type === "string" ? body.event_type : "";
  if (!(CLIENT_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return new NextResponse(null, { status: 400 });
  }

  const tripId =
    typeof body.trip_id === "number" && Number.isInteger(body.trip_id) && body.trip_id > 0
      ? body.trip_id
      : null;

  const result = recordEvent({
    eventType,
    sessionId,
    tripId,
    path: typeof body.path === "string" ? body.path : null,
    meta:
      typeof body.meta === "object" && body.meta !== null && !Array.isArray(body.meta)
        ? (body.meta as Record<string, unknown>)
        : {},
  });

  if (result === "rejected") return new NextResponse(null, { status: 400 });
  // "stored" and "error" both return 204 — a DB hiccup must not surface.
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/app/api/event/route.test.ts`
Expected: PASS (11/11)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/event/route.ts src/app/api/event/route.test.ts
git commit -m "feat(analytics): cookieless best-effort POST /api/event ingest"
```

---

### Task 3: Client `track()` helper + `TrackPageView` component

**Files:**
- Create: `src/lib/analytics/track.ts`
- Create: `src/components/TrackPageView.tsx`
- Test: `src/lib/analytics/track.test.ts`, `src/components/TrackPageView.test.tsx`

**Interfaces:**
- Produces: `track(eventType: string, options?: { tripId?: number | null; meta?: Record<string, string | number | boolean> }): void` — fire-and-forget, never throws, posts a JSON **string** (not a Blob) to `/api/event` via `navigator.sendBeacon`, falling back to `fetch(..., { keepalive: true })`. Payload shape: `{ event_type, trip_id, path: window.location.pathname, meta }`.
- Produces: `<TrackPageView eventType="guide_view" | "planner_start" meta?={...} />` — client component, renders nothing, fires exactly one `track()` per mount (ref-guarded against React StrictMode's dev double-effect; `next.config.ts` has `reactStrictMode: true`).
- Consumed by: Task 4 (pages) and Task 5 (Atlas wiring).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/analytics/track.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { track } from "./track";

describe("track()", () => {
  const sendBeaconMock = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    sendBeaconMock.mockReset().mockReturnValue(true);
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    // jsdom's navigator has no sendBeacon — define it per-test.
    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeaconMock,
      configurable: true,
      writable: true,
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("posts the payload to /api/event via sendBeacon as a JSON string", () => {
    track("guide_view", { meta: { slug: "miami" } });
    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeaconMock.mock.calls[0];
    expect(url).toBe("/api/event");
    const payload = JSON.parse(body as string);
    expect(payload).toMatchObject({
      event_type: "guide_view",
      trip_id: null,
      meta: { slug: "miami" },
    });
    expect(typeof payload.path).toBe("string");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("includes tripId when provided", () => {
    track("atlas_consent", { tripId: 7 });
    expect(JSON.parse(sendBeaconMock.mock.calls[0][1] as string).trip_id).toBe(7);
  });

  it("falls back to keepalive fetch when sendBeacon rejects the payload", () => {
    sendBeaconMock.mockReturnValue(false);
    track("guide_view");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/event",
      expect.objectContaining({ method: "POST", keepalive: true })
    );
  });

  it("falls back to keepalive fetch when sendBeacon is unavailable", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    track("guide_view");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws — even when transports blow up", () => {
    sendBeaconMock.mockImplementation(() => {
      throw new Error("boom");
    });
    fetchMock.mockRejectedValue(new Error("down"));
    expect(() => track("guide_view")).not.toThrow();
  });
});
```

```tsx
// src/components/TrackPageView.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { StrictMode } from "react";
import { render } from "@testing-library/react";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics/track";
import TrackPageView from "./TrackPageView";

describe("<TrackPageView />", () => {
  beforeEach(() => vi.mocked(track).mockClear());

  it("fires exactly one event per mount, even under StrictMode double-effects", () => {
    render(
      <StrictMode>
        <TrackPageView eventType="guide_view" meta={{ slug: "miami" }} />
      </StrictMode>
    );
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("guide_view", { meta: { slug: "miami" } });
  });

  it("renders nothing", () => {
    const { container } = render(<TrackPageView eventType="planner_start" />);
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/lib/analytics/track.test.ts src/components/TrackPageView.test.tsx`
Expected: FAIL — both modules do not exist.

- [ ] **Step 3: Implement**

```typescript
// src/lib/analytics/track.ts
// Client-side beacon for the first-party analytics ingest (/api/event).
// Fire-and-forget by contract: NEVER throws, never blocks the UI, sets no
// cookie and makes no third-party request. Session identity is resolved
// server-side from the existing httpOnly tpi_guest cookie / auth session —
// the client neither reads nor sends any identifier.

export interface TrackOptions {
  tripId?: number | null;
  meta?: Record<string, string | number | boolean>;
}

export function track(eventType: string, options: TrackOptions = {}): void {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;

    const payload = JSON.stringify({
      event_type: eventType,
      trip_id: options.tripId ?? null,
      path: window.location.pathname,
      meta: options.meta ?? {},
    });

    // sendBeacon survives page unloads and never blocks; a plain string body
    // posts as text/plain, which /api/event parses via req.text().
    if (
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon("/api/event", payload)
    ) {
      return;
    }

    void fetch("/api/event", { method: "POST", body: payload, keepalive: true }).catch(() => {});
  } catch {
    // Analytics must never break the app.
  }
}
```

```tsx
// src/components/TrackPageView.tsx
"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/track";

interface Props {
  eventType: "guide_view" | "planner_start";
  meta?: Record<string, string | number | boolean>;
}

// Renders nothing; fires one analytics beacon per mount. The ref guard keeps
// React StrictMode's dev double-effect from double-counting.
// MOUNT-SCOPED SEMANTICS (review NIT-5): a soft navigation that reconciles the
// SAME component instance (e.g. article→article within one dynamic segment)
// will NOT re-fire — give the instance a navigation-scoped `key` (the article
// page passes key={slug}) or this undercounts if such links are ever added.
export default function TrackPageView({ eventType, meta }: Props) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(eventType, { meta });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- src/lib/analytics/track.test.ts src/components/TrackPageView.test.tsx`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/track.ts src/components/TrackPageView.tsx src/lib/analytics/track.test.ts src/components/TrackPageView.test.tsx
git commit -m "feat(analytics): sendBeacon track() helper and TrackPageView component"
```

---

### Task 4: Wire `guide_view` + `planner_start` into the five pages

**Files:**
- Modify: `src/app/[locale]/[slug]/page.tsx` (article page — server component)
- Modify: `src/app/[locale]/guides/page.tsx` (server component)
- Modify: `src/app/[locale]/destinations/page.tsx` (client component)
- Modify: `src/app/[locale]/hot-deals/page.tsx` (client component)
- Modify: `src/app/[locale]/planner/page.tsx` (server component)
- Test: none new (presentational wiring — verified by grep gates here, by `tests/e2e/analytics.spec.ts` in Task 10, and live smoke in Task 11)

**Interfaces:**
- Consumes: `TrackPageView` from Task 3 (`@/components/TrackPageView` — a client component; importing it into server components is the standard client-boundary pattern).
- Produces: `guide_view` fires on article, guides, destinations, and hot-deals views (path distinguishes surfaces; articles add `meta.slug`); `planner_start` fires on planner views (both the TripForm and PlannerDashboard states — landing on the planner IS the funnel's "planner start").

Each of these five files renders `<Header />` exactly once. Before editing each file, verify: `grep -c "<Header />" <file>` prints `1`. Insert the `TrackPageView` line on the line immediately after that `<Header />`, matching the `<Header />` line's indentation.

- [ ] **Step 1: Wire the article page**

In `src/app/[locale]/[slug]/page.tsx`:
1. Add to the import block: `import TrackPageView from "@/components/TrackPageView";`
2. The return statement starts `return (` then `<>` then `<Header />`. Replace:

```tsx
    <>
      <Header />
```

with

```tsx
    <>
      <Header />
      <TrackPageView key={slug} eventType="guide_view" meta={{ slug }} />
```

(`slug` is already in scope — destructured from `await params` at the top of `LocaleArticlePage`. The `key={slug}` makes a future article→article soft navigation remount the tracker so `guide_view` re-fires per article — review NIT-5; no such link surface exists today, this is cheap prevention.)

- [ ] **Step 2: Wire the guides page**

In `src/app/[locale]/guides/page.tsx`: add the same import; insert `<TrackPageView eventType="guide_view" />` on the line after `<Header />`.

- [ ] **Step 3: Wire the destinations page**

In `src/app/[locale]/destinations/page.tsx` (already `"use client"`): add the same import; insert `<TrackPageView eventType="guide_view" />` on the line after `<Header />` (line ~181, inside the component's single JSX return).

- [ ] **Step 4: Wire the hot-deals page**

In `src/app/[locale]/hot-deals/page.tsx` (already `"use client"`): add the same import; insert `<TrackPageView eventType="guide_view" />` on the line after `<Header />`.

- [ ] **Step 5: Wire the planner page**

In `src/app/[locale]/planner/page.tsx`: add the same import; insert `<TrackPageView eventType="planner_start" />` on the line after `<Header />`. Note: this fires for BOTH planner states (logged-out `TripForm` and `PlannerDashboard`) — deliberate; the spec's "(PlannerDashboard)" is a location hint, and a new user's first `TripForm` view is exactly the funnel's planner start.

- [ ] **Step 6: Verify wiring + no regressions**

Run: `grep -rn "TrackPageView" src/app/ | sort`
Expected: exactly 10 lines — one import + one JSX usage in each of the 5 files, with `eventType="planner_start"` only in `planner/page.tsx` and `meta={{ slug }}` only in `[slug]/page.tsx`.

Run: `npm run lint && npm run test:unit`
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/[slug]/page.tsx" "src/app/[locale]/guides/page.tsx" "src/app/[locale]/destinations/page.tsx" "src/app/[locale]/hot-deals/page.tsx" "src/app/[locale]/planner/page.tsx"
git commit -m "feat(analytics): fire guide_view and planner_start page beacons"
```

---

### Task 5: Wire the three Atlas client events (`atlas_health_hidden`, `atlas_consent`, `tool_result_rendered`)

**Files:**
- Create: `src/lib/analytics/tool-frame.ts` (pure, unit-testable tool-frame decision helper — review MEDIUM-2)
- Modify: `src/hooks/useAssistantHealth.ts`
- Modify: `src/components/AssistantChat.tsx` (two insertion points ONLY — the consent effect ~line 894 and the `[TOOL:` stream branch ~line 808 — do not touch anything else in this 1622-line component)
- Test: `src/hooks/useAssistantHealth.test.ts` (new), `src/lib/analytics/tool-frame.test.ts` (new)

**Interfaces:**
- Consumes: `track` from Task 3 (`@/lib/analytics/track`).
- Produces: `getTrackableToolName(data: string): string | null` (pure — returns the tool name for a countable `[TOOL:...]` frame, `null` for `is_error` frames and non-tool data; unparseable payloads count because they still render as text). Extracting this keeps the giant component's insertion to two lines with no inline `JSON.parse`, and gives the tool-frame decision deterministic unit coverage the component itself cannot get (review MEDIUM-2).
- Produces: `atlas_health_hidden` fires when a FRESH health check (not a sessionStorage cache read) resolves unhealthy — i.e., the moment the health gate decides to hide Atlas's proactive surfaces (bubble + consent chip). `atlas_consent` fires when the trigger machine reaches `consented` (the existing consent effect). `tool_result_rendered` fires per non-error `[TOOL:...]` frame received, with `meta.tool` = tool name (error frames are skipped because `AssistantChat`'s card renderer returns `null` for `is_error` results — nothing renders).

<!-- nit (review NIT-3): dev-only StrictMode double-fire — two parallel fresh health checks can each call track("atlas_health_hidden") before either writes the sessionStorage cache. Prod is single-fire (sole consumer, StrictMode double-invocation is dev-only); accepted as analytics-grade. Optional module-level once-per-window guard if dev-DB hygiene ever matters. -->

Context: the tool-frame format is `[TOOL:${name}]${JSON.stringify(result)}` (emitted at `src/lib/atlas/tool-loop.ts:196`); the card renderer returns `null` for `is_error` payloads (`AssistantChat.tsx:297`).

- [ ] **Step 1: Write the failing tests (hook + tool-frame helper)**

```typescript
// src/hooks/useAssistantHealth.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics/track";
import { useAssistantHealth } from "./useAssistantHealth";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("useAssistantHealth — atlas_health_hidden instrumentation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(track).mockClear();
    fetchMock.mockReset();
  });

  it("fires atlas_health_hidden exactly once when a fresh check reports unhealthy", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ healthy: false }) });
    renderHook(() => useAssistantHealth());
    await waitFor(() => expect(track).toHaveBeenCalledWith("atlas_health_hidden"));
    expect(
      vi.mocked(track).mock.calls.filter((c) => c[0] === "atlas_health_hidden")
    ).toHaveLength(1);
  });

  it("does not fire when the fresh check reports healthy", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ healthy: true }) });
    const { result } = renderHook(() => useAssistantHealth());
    await waitFor(() => expect(result.current.healthy).toBe(true));
    expect(track).not.toHaveBeenCalled();
  });

  it("does not fire on cached reads (already counted when the cache was written)", async () => {
    sessionStorage.setItem(
      "atlas_health_v1",
      JSON.stringify({ healthy: false, checkedAt: Date.now() })
    );
    const { result } = renderHook(() => useAssistantHealth());
    await waitFor(() => expect(result.current.healthy).toBe(false));
    expect(track).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires when the health endpoint itself is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    renderHook(() => useAssistantHealth());
    await waitFor(() => expect(track).toHaveBeenCalledWith("atlas_health_hidden"));
  });
});
```

```typescript
// src/lib/analytics/tool-frame.test.ts
import { describe, it, expect } from "vitest";
import { getTrackableToolName } from "./tool-frame";

// Frame format pinned by src/lib/atlas/tool-loop.ts:196:
//   `[TOOL:${block.name}]${JSON.stringify(result)}`
describe("getTrackableToolName", () => {
  it("returns the tool name for a non-error tool frame (a card renders → counted)", () => {
    expect(getTrackableToolName('[TOOL:search_flights]{"is_error":false,"data":[]}')).toBe(
      "search_flights"
    );
  });

  it("returns null for an is_error frame (renderer returns null → nothing renders)", () => {
    expect(getTrackableToolName('[TOOL:search_flights]{"is_error":true}')).toBeNull();
  });

  it("counts frames with unparseable payloads (they still render as text) and ignores non-tool data", () => {
    expect(getTrackableToolName("[TOOL:get_deals]not-json{{{")).toBe("get_deals");
    expect(getTrackableToolName("plain assistant prose")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/hooks/useAssistantHealth.test.ts src/lib/analytics/tool-frame.test.ts`
Expected: FAIL — the hook's `track` is never called (its two positive tests time out in `waitFor`; the two negative tests pass), and `./tool-frame` does not exist.

- [ ] **Step 3: Instrument `src/hooks/useAssistantHealth.ts`**

1. Add after the existing `import { useEffect, useState } from "react";`:

```typescript
import { track } from "@/lib/analytics/track";
```

2. Replace the fetch chain's `.then`/`.catch`:

```typescript
      .then((data: { healthy?: boolean }) => {
        const result = Boolean(data.healthy);
        writeCache(result);
        if (!cancelled) setHealthy(result);
      })
      .catch(() => {
        writeCache(false);
        if (!cancelled) setHealthy(false);
      });
```

with

```typescript
      .then((data: { healthy?: boolean }) => {
        const result = Boolean(data.healthy);
        writeCache(result);
        // Funnel event: a fresh (non-cached) check found Atlas unhealthy —
        // its proactive surfaces (bubble, consent chip) will be hidden.
        if (!result) track("atlas_health_hidden");
        if (!cancelled) setHealthy(result);
      })
      .catch(() => {
        writeCache(false);
        track("atlas_health_hidden");
        if (!cancelled) setHealthy(false);
      });
```

- [ ] **Step 4: Implement `src/lib/analytics/tool-frame.ts`**

```typescript
// src/lib/analytics/tool-frame.ts
// Pure decision helper for the tool_result_rendered funnel event (review
// MEDIUM-2: keep the decision unit-testable outside the 1622-line component).
// Frame format (src/lib/atlas/tool-loop.ts:196): `[TOOL:${name}]${JSON.stringify(result)}`.
// Returns the tool name when the frame will render something countable:
// - non-error frames render a card → counted
// - is_error frames render nothing (AssistantChat's renderer returns null) → null
// - unparseable payloads still render as text → counted
export function getTrackableToolName(data: string): string | null {
  const toolName = /^\[TOOL:(\w+)\]/.exec(data)?.[1];
  if (!toolName) return null;
  try {
    const payload = JSON.parse(data.slice(data.indexOf("]") + 1)) as {
      is_error?: boolean;
    } | null;
    if (payload && typeof payload === "object" && Boolean(payload.is_error)) return null;
  } catch {
    // Unparseable tool payloads still render as text; count them.
  }
  return toolName;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- src/hooks/useAssistantHealth.test.ts src/lib/analytics/tool-frame.test.ts`
Expected: PASS (7/7 — 4 hook + 3 helper)

- [ ] **Step 6: Instrument `src/components/AssistantChat.tsx`**

1. Add after the existing `import { decodeSseData } from "@/lib/atlas/sse";`:

```typescript
import { track } from "@/lib/analytics/track";
import { getTrackableToolName } from "@/lib/analytics/tool-frame";
```

2. **Consent event.** Find the consent effect (~line 894; unique anchor). Replace:

```typescript
  useEffect(() => {
    if (atlasTrigger.status !== 'consented') return;
    if (!tripCtx.destination || tripCtx.destination === 'your destination') return;

    const prompt = buildAutoSearchPrompt({
```

with

```typescript
  useEffect(() => {
    if (atlasTrigger.status !== 'consented') return;
    if (!tripCtx.destination || tripCtx.destination === 'your destination') return;

    track("atlas_consent", { tripId: tripCtx.tripId ?? null });

    const prompt = buildAutoSearchPrompt({
```

3. **Tool-result event.** Find the tool-frame branch inside the SSE read loop (~line 807; unique anchor). Replace:

```typescript
            // Tool result — append as-is (will be parsed by renderer)
            if (data.startsWith("[TOOL:")) {
              fullText += data;
```

with

```typescript
            // Tool result — append as-is (will be parsed by renderer)
            if (data.startsWith("[TOOL:")) {
              const trackableTool = getTrackableToolName(data);
              if (trackableTool) track("tool_result_rendered", { meta: { tool: trackableTool } });
              fullText += data;
```

- [ ] **Step 7: Verify wiring + no regressions**

Run: `grep -n "track(" src/components/AssistantChat.tsx src/hooks/useAssistantHealth.ts`
Expected: exactly 4 call sites — `atlas_consent` and `tool_result_rendered` in AssistantChat; two `atlas_health_hidden` in useAssistantHealth.

Run: `npm run lint && npm run test:unit`
Expected: both green (all pre-existing Atlas tests unaffected — no brain logic changed).

- [ ] **Step 8: Commit**

```bash
git add src/lib/analytics/tool-frame.ts src/lib/analytics/tool-frame.test.ts src/hooks/useAssistantHealth.ts src/hooks/useAssistantHealth.test.ts src/components/AssistantChat.tsx
git commit -m "feat(analytics): fire atlas_health_hidden, atlas_consent, tool_result_rendered beacons"
```

---

### Task 6: Server-side `trip_created` capture at `POST /api/trips`

**Files:**
- Modify: `src/app/api/trips/route.ts`
- Test: `src/app/api/trips/route.test.ts` (new)

**Interfaces:**
- Consumes: `recordEvent` from Task 1. The route already resolves `userId` via `getOrCreateGuest()` (that call is pre-existing and correct here — trip creation legitimately establishes a guest session; the cookieless rule applies to the analytics ingest, not to trips).
- Produces: every successful trip INSERT writes one `trip_created` event with `session_id = userId`, `trip_id = lastInsertRowid`, `path = "/api/trips"`, `meta = { entry_mode }`. Captured server-side (no beacon) — and genuinely unspoofable, because the public ingest rejects `trip_created` (Task 2's `CLIENT_EVENT_TYPES` check; review HIGH-2): this route is the only writer.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/trips/route.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// In-memory DB — never touches the real data/tpi.db. The trips schema below
// is src/lib/db.ts's CREATE TABLE trips flattened with every ALTER TABLE
// migration column the route's INSERT uses.
let memDb: Database.Database;
vi.mock("@/lib/db", () => ({ getDb: () => memDb }));

vi.mock("@/lib/guest", () => ({
  getUserId: vi.fn(async () => ({ userId: "1", isGuest: true, guestToken: "tok" })),
  getOrCreateGuest: vi.fn(async () => ({ userId: "1", isGuest: true, guestToken: "tok" })),
}));

import { POST } from "./route";
import type { NextRequest } from "next/server";

const TRIPS_SCHEMA = `
  CREATE TABLE trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    destination TEXT NOT NULL,
    start_date TEXT, end_date TEXT, budget TEXT,
    travelers_adults INTEGER NOT NULL DEFAULT 1,
    travelers_children INTEGER NOT NULL DEFAULT 0,
    rooms INTEGER NOT NULL DEFAULT 1,
    interests TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    budget_override REAL,
    trip_type TEXT DEFAULT 'round_trip',
    want_hotel INTEGER NOT NULL DEFAULT 1,
    want_car INTEGER NOT NULL DEFAULT 0,
    want_limo INTEGER NOT NULL DEFAULT 0,
    want_activities INTEGER NOT NULL DEFAULT 1,
    budget_mode TEXT DEFAULT 'preset',
    budget_amount REAL,
    budget_categories TEXT,
    flexible_window TEXT,
    trip_length TEXT,
    origin TEXT,
    nearby_airports TEXT,
    entry_mode TEXT DEFAULT 'direct',
    quiz_budget TEXT, quiz_vibes TEXT, quiz_when TEXT, quiz_who TEXT,
    quiz_group_size INTEGER,
    group_share INTEGER DEFAULT 0,
    group_costsplit INTEGER DEFAULT 0,
    group_consensus INTEGER DEFAULT 0,
    origin_auto TEXT
  );
`;

const EVENTS_SCHEMA = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    trip_id INTEGER,
    session_id TEXT,
    path TEXT,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request("http://localhost:3000/api/trips", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/trips — trip_created analytics capture", () => {
  beforeEach(() => {
    memDb = new Database(":memory:");
    memDb.exec(TRIPS_SCHEMA);
    memDb.exec(EVENTS_SCHEMA);
  });

  it("creates the trip AND records one trip_created event keyed to the session", async () => {
    const res = await POST(makeRequest({ name: "Test", destination: "Miami", entry_mode: "quiz" }));
    expect(res.status).toBe(201);
    const trip = await res.json();
    const events = memDb.prepare("SELECT * FROM events").all() as Array<{
      event_type: string;
      trip_id: number;
      session_id: string;
      path: string;
      meta_json: string;
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "trip_created",
      trip_id: trip.id,
      session_id: "1",
      path: "/api/trips",
    });
    expect(JSON.parse(events[0].meta_json)).toEqual({ entry_mode: "quiz" });
  });

  it("still creates the trip when analytics storage is broken (best-effort)", async () => {
    memDb.exec("DROP TABLE events");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeRequest({ name: "Test", destination: "Miami" }));
    expect(res.status).toBe(201);
    expect(memDb.prepare("SELECT COUNT(*) AS n FROM trips").get()).toMatchObject({ n: 1 });
    errorSpy.mockRestore();
  });

  it("records no event when validation rejects the trip", async () => {
    const res = await POST(makeRequest({ name: "No destination" }));
    expect(res.status).toBe(400);
    expect(memDb.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/app/api/trips/route.test.ts`
Expected: FAIL — test 1 finds 0 events rows (tests 2 and 3 may already pass; that's fine).

- [ ] **Step 3: Implement the capture in `src/app/api/trips/route.ts`**

1. Add to the imports:

```typescript
import { recordEvent } from "@/lib/analytics/events";
```

2. Replace the end of `POST`:

```typescript
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(toTripDto(trip), { status: 201 });
```

with

```typescript
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(result.lastInsertRowid);

  // Server-side funnel capture (Phase 2A) — recordEvent never throws, so
  // analytics can never break trip creation.
  recordEvent({
    eventType: "trip_created",
    sessionId: userId,
    tripId: Number(result.lastInsertRowid),
    path: "/api/trips",
    meta: { entry_mode: entry_mode || "direct" },
  });

  return NextResponse.json(toTripDto(trip), { status: 201 });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- src/app/api/trips/route.test.ts`
Expected: PASS (3/3)

Run: `npm run test:unit`
Expected: full suite green (the trips route is exercised by e2e elsewhere; unit suite must not regress).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/trips/route.ts src/app/api/trips/route.test.ts
git commit -m "feat(analytics): capture trip_created server-side at POST /api/trips"
```

---

### Task 7: GSC verification meta (env-driven) + sitemap/robots confirmation + console runbook

**Files:**
- Create: `src/lib/site-verification.ts`
- Modify: `src/app/[locale]/layout.tsx` (the real layout — `src/app/layout.tsx` just returns children)
- Modify: `.env.example`
- Create: `docs/product/ANALYTICS.md` (GSC runbook section; Task 9 appends the analytics sections)
- Test: `src/lib/site-verification.test.ts`

**Interfaces:**
- Produces: `googleSiteVerification(): string | undefined` — trimmed `GOOGLE_SITE_VERIFICATION` env value, `undefined` when unset/blank. The layout's `metadata` gains `verification: { google: <token> }` ONLY when the token exists → Next renders `<meta name="google-site-verification" content="...">` iff the env var is set; nothing when absent (safe default — O1 token from Jose is non-blocking).
- Note: `export const metadata` is evaluated at build/render time — changing the token on the VPS requires `npm run build && pm2 restart tpi` (matches the existing deploy flow). Document this in the runbook.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/site-verification.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { googleSiteVerification } from "./site-verification";

describe("googleSiteVerification", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the token when GOOGLE_SITE_VERIFICATION is set", () => {
    vi.stubEnv("GOOGLE_SITE_VERIFICATION", "tpi-gsc-token-123");
    expect(googleSiteVerification()).toBe("tpi-gsc-token-123");
  });

  it("returns undefined when unset or blank — so no meta tag renders", () => {
    vi.stubEnv("GOOGLE_SITE_VERIFICATION", "");
    expect(googleSiteVerification()).toBeUndefined();
    vi.stubEnv("GOOGLE_SITE_VERIFICATION", "   ");
    expect(googleSiteVerification()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/site-verification.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/site-verification.ts
import "server-only";

// Env-driven Google Search Console ownership token (O1: value supplied by
// Jose from GSC; DNS-TXT is the no-code alternative). Read at build/render
// time — changing it on the VPS requires `npm run build` + `pm2 restart tpi`.
// When unset, no meta tag renders.
export function googleSiteVerification(): string | undefined {
  const value = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  return value ? value : undefined;
}
```

(`server-only` is aliased to a stub in `vitest.config.ts`, so the unit test imports cleanly — same pattern as `src/lib/server-config.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/site-verification.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Wire the layout metadata**

In `src/app/[locale]/layout.tsx`:

1. Add after `import { routing } from "@/i18n/routing";`:

```typescript
import { googleSiteVerification } from "@/lib/site-verification";
```

2. Replace:

```typescript
export const metadata: Metadata = {
  title: "TravelPlanInfo • Plan Your Next Trip",
  description: "Expert itineraries, hidden gems, and deals for every kind of traveler.",
  icons: {
```

with

```typescript
const gscToken = googleSiteVerification();

export const metadata: Metadata = {
  title: "TravelPlanInfo • Plan Your Next Trip",
  description: "Expert itineraries, hidden gems, and deals for every kind of traveler.",
  // Renders <meta name="google-site-verification" ...> only when the env var
  // is set (O1: token from Jose). Absent env → no tag, zero regression.
  ...(gscToken ? { verification: { google: gscToken } } : {}),
  icons: {
```

3. In `.env.example`, append after the `OPENAI_API_KEY=` line:

```
GOOGLE_SITE_VERIFICATION=
```

- [ ] **Step 6: Confirm sitemap + robots (already-existing infrastructure)**

Run: `ls -la src/app/sitemap.ts src/app/robots.ts && grep -n "sitemap.xml\|disallow" src/app/robots.ts && grep -n "SITE_URL" src/app/sitemap.ts | head -3`
Expected: both files exist; robots points to `https://travelplaninfo.com/sitemap.xml` and disallows `/api/`; sitemap uses `https://travelplaninfo.com`. Do NOT modify either file — they are already correct (locale-aware, article alternates). Record the confirmation in the runbook below.

- [ ] **Step 7: Create `docs/product/ANALYTICS.md` with the GSC runbook**

```markdown
# TPI Analytics & Search Console — Setup, Access, Definitions

**Owner:** Jose (console actions) / Hermes (code). **Phase:** 2A (D10).
**Code:** `src/lib/analytics/` (ingest/reporting), `src/app/api/event/` (ingest route),
`src/app/api/analytics/summary/` (reporting route), `src/lib/site-verification.ts` (GSC meta).

## Google Search Console — runbook (Jose actions)

Status: **BLOCKED on O1** — verification token not yet supplied. Recorded per
IMPLEMENTATION_PLAN.md Phase 2A acceptance ("GSC property is verified or explicit
credential blocker is recorded"). Everything below is a console-side action; the
code side (env-driven meta tag) ships with this phase and renders nothing until
the token is set.

1. In [Google Search Console](https://search.google.com/search-console), add a
   **URL-prefix property** for `https://travelplaninfo.com/`.
2. Choose the **HTML tag** verification method and copy the `content="..."` value.
   (Alternative requiring no deploy: **DNS TXT record** on the domain — equivalent,
   Jose's choice.)
3. On the VPS (`ssh root@104.225.221.138`), add to `/home/travelplaninfo/nextjs/.env.local`:
   `GOOGLE_SITE_VERIFICATION=<the content value>`
4. Rebuild + restart (token is read at build time):
   `cd /home/travelplaninfo/nextjs && npm run build && pm2 restart tpi`
5. Confirm the tag: `curl -s https://travelplaninfo.com/ | grep google-site-verification`
6. Click **Verify** in the console.
7. Submit the sitemap: Sitemaps → add `https://travelplaninfo.com/sitemap.xml` → record
   the submission date/status here: `submitted: ____-__-__, status: ____`.
8. Optionally use URL Inspection → Request indexing for `/` and 2-3 top guides.

Sitemap/robots status (confirmed 2026-07-07, this phase): `src/app/sitemap.ts` (dynamic,
locale-aware, article `alternates.languages`) and `src/app/robots.ts` (disallows `/api/`,
points at the sitemap) already exist and required no changes.
```

- [ ] **Step 8: Lint + unit gate**

Run: `npm run lint && npm run test:unit`
Expected: both green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/site-verification.ts src/lib/site-verification.test.ts "src/app/[locale]/layout.tsx" .env.example docs/product/ANALYTICS.md
git commit -m "feat(seo): env-driven GSC verification meta + console runbook (O1 blocker recorded)"
```

---

### Task 8: Privacy-page reconciliation (describe the analytics that now exists)

**Files:**
- Modify: `src/app/[locale]/privacy/page.tsx`
- Test: none new (static copy — data-only change, verified by grep gates + lint; precedent: help-content task in `2026-07-06-atlas-review-fixes.md` Task 13)

**Why:** the current §1/§3 copy is aspirational — it describes third-party "analytics tools" that "may use cookies" with browser opt-out. After this phase the truth is: cookieless first-party analytics, no third parties, no IP stored. The page must match reality (spec §3.5). Because the system is cookieless, no EU consent banner is required.

- [ ] **Step 1: Apply the three copy edits**

Edit 1 — replace:

```tsx
        <p className="text-sm text-gray-500 mb-8">Last updated: March 2026</p>
```

with

```tsx
        <p className="text-sm text-gray-500 mb-8">Last updated: July 2026</p>
```

Edit 2 — in section "1. Information We Collect", replace:

```tsx
            <p className="text-gray-700">
              We may collect email addresses (newsletters) and non-personally identifiable information via analytics tools.
            </p>
```

with

```tsx
            <p className="text-gray-700">
              We collect email addresses when you subscribe to our newsletter, the trip details you choose to
              save in the planner, and usage events recorded by our own first-party measurement system
              (no names, no email harvesting, no IP addresses stored — and reported only in aggregate).
            </p>
```

(Wording note, review MEDIUM-3: do NOT claim the system *stores* only aggregates — the `events` table stores event-level rows keyed by a pseudonymous session id; only reporting aggregates.)

Edit 3 — in section "3. Cookies &amp; Analytics", replace:

```tsx
            <p className="text-gray-700">
              This site uses analytics to understand how visitors use the site. These tools may use cookies. You can opt out via your browser settings.
            </p>
```

with

```tsx
            <p className="text-gray-700">
              We measure site usage with a privacy-first, first-party analytics system that runs entirely on our
              own servers. It sets no cookies, uses no fingerprinting, and sends nothing to third-party analytics
              services. It stores event-level usage records tied to a random session identifier — no names, no
              email addresses, no IP addresses — and we report them only in aggregate, as counts of page views
              and trip-planning actions.
            </p>
            <p className="text-gray-700 mt-2">
              The only cookies this site sets are functional: temporary anonymous planning cookies (kept for 7
              days) that keep a guest&apos;s trip plans available while planning, a language-preference cookie when
              your language is detected or switched, and authentication cookies if you sign in. None of them is
              used for analytics or advertising.
            </p>
```

(Accuracy notes, review MEDIUM-3: "event-level … reported only in aggregate" — not "aggregate counts", which is false at the storage layer; "planning cookies (kept for 7 days)" — the guest mechanism is a persistent 7-day PAIR, `tpi_guest` httpOnly + `tpi_guest_hint` client-readable (`guest.ts:82-97`), not a singular session-scoped cookie; the language-preference line discloses next-intl's `NEXT_LOCALE` cookie, which locale negotiation can set. Task 11 Step 4 reality-checks the locale cookie.)

- [ ] **Step 2: Verify the stale claims are gone and the new copy is in**

Run: `grep -c "These tools may use cookies\|opt out via your browser settings\|via analytics tools" "src/app/[locale]/privacy/page.tsx"`
Expected: `0`

Run: `grep -c "first-party" "src/app/[locale]/privacy/page.tsx"`
Expected: `2`

- [ ] **Step 3: Lint + unit gate**

Run: `npm run lint && npm run test:unit`
Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/privacy/page.tsx"
git commit -m "docs(privacy): reconcile policy with cookieless first-party analytics reality"
```

---

### Task 9: Reporting layer — funnel summary lib, token-gated `/api/analytics/summary`, documented SQL, O3 naming reconcile

**Files:**
- Create: `src/lib/analytics/reporting.ts`
- Create: `src/app/api/analytics/summary/route.ts`
- Modify: `src/lib/server-config.ts` (add `getAnalyticsSummaryToken()` after `getOpenAIApiKey()`)
- Modify: `.env.example` (add `ANALYTICS_SUMMARY_TOKEN=`)
- Modify: `docs/product/ANALYTICS.md` (append event definitions + queries + access sections)
- Modify: `docs/product/VERIFICATION_CHECKLIST.md` (lines 194-195 — O3: `affiliate_click_events` → real table names)
- Test: `src/lib/analytics/reporting.test.ts`, `src/app/api/analytics/summary/route.test.ts`

**Interfaces:**
- Consumes: `ALLOWED_EVENT_TYPES`/`AllowedEventType` from Task 1; `getDb` from `@/lib/db`; `readTrimmedEnv` pattern in `server-config.ts`.
- Produces: `getFunnelSummary(since?: string): FunnelSummary` where `FunnelSummary = { since: string | null; events: Record<AllowedEventType, number>; tripSessions: number; affiliateClicks: number | null; affiliateClicksPerTripSession: number | null }`. **Soft-gate:** `affiliate_click` is Phase 3's table — when it does not exist yet, `affiliateClicks` and the ratio are `null` (queryable shape, honest absence; NEVER create that table here). `GET /api/analytics/summary` is **fail-closed**: 404 when `ANALYTICS_SUMMARY_TOKEN` is unset, 401 on a wrong/missing `Authorization: Bearer` header, 200 JSON otherwise; optional `?since=YYYY-MM-DD`.

- [ ] **Step 1: Write the failing reporting-lib test**

```typescript
// src/lib/analytics/reporting.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

let memDb: Database.Database;
vi.mock("@/lib/db", () => ({ getDb: () => memDb }));

import { getFunnelSummary } from "./reporting";

function seedEvent(type: string, sessionId: string | null, createdAt = "2026-07-07 12:00:00") {
  memDb
    .prepare(
      "INSERT INTO events (event_type, session_id, meta_json, created_at) VALUES (?, ?, '{}', ?)"
    )
    .run(type, sessionId, createdAt);
}

const AFFILIATE_CLICK_SCHEMA = `
  CREATE TABLE affiliate_click (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id TEXT NOT NULL,
    trip_id INTEGER,
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

describe("getFunnelSummary", () => {
  beforeEach(() => {
    memDb = new Database(":memory:");
    memDb.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        trip_id INTEGER,
        session_id TEXT,
        path TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  it("counts each funnel event type, zero-filling missing ones", () => {
    seedEvent("guide_view", "1");
    seedEvent("guide_view", "2");
    seedEvent("trip_created", "1");
    const summary = getFunnelSummary();
    expect(summary.events.guide_view).toBe(2);
    expect(summary.events.trip_created).toBe(1);
    expect(summary.events.atlas_consent).toBe(0);
    expect(summary.events.tool_result_rendered).toBe(0);
  });

  it("reports affiliate metrics as null before Phase 3 ships the affiliate_click table", () => {
    seedEvent("trip_created", "1");
    const summary = getFunnelSummary();
    expect(summary.affiliateClicks).toBeNull();
    expect(summary.affiliateClicksPerTripSession).toBeNull();
    expect(summary.tripSessions).toBe(1);
  });

  it("computes affiliate clicks per trip session once the Phase 3 table exists", () => {
    memDb.exec(AFFILIATE_CLICK_SCHEMA);
    seedEvent("trip_created", "1");
    seedEvent("trip_created", "2");
    const insert = memDb.prepare(
      "INSERT INTO affiliate_click (partner_id, session_id, created_at) VALUES (?, ?, ?)"
    );
    insert.run("hotels_cj", "1", "2026-07-07 13:00:00");
    insert.run("klook", "2", "2026-07-07 13:05:00");
    insert.run("klook", "1", "2026-07-07 13:10:00");
    const summary = getFunnelSummary();
    expect(summary.tripSessions).toBe(2);
    expect(summary.affiliateClicks).toBe(3);
    expect(summary.affiliateClicksPerTripSession).toBe(1.5);
  });

  it("applies the since filter", () => {
    seedEvent("guide_view", "1", "2026-06-01 00:00:00");
    seedEvent("guide_view", "1", "2026-07-07 00:00:01");
    const summary = getFunnelSummary("2026-07-01");
    expect(summary.events.guide_view).toBe(1);
    expect(summary.since).toBe("2026-07-01");
  });

  it("returns a null ratio (not NaN/Infinity) when there are no trip sessions", () => {
    memDb.exec(AFFILIATE_CLICK_SCHEMA);
    const summary = getFunnelSummary();
    expect(summary.tripSessions).toBe(0);
    expect(summary.affiliateClicksPerTripSession).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/analytics/reporting.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/analytics/reporting.ts`**

```typescript
// src/lib/analytics/reporting.ts
// Read-side of the first-party analytics layer. Answers the Phase 2A MVP
// question: affiliate clicks per trip session. The affiliate_click table is
// OWNED BY PHASE 3 (/api/affiliate/click); until it ships, its metrics are
// null — queryable shape, honest absence. Do not create that table here.
import { getDb } from "@/lib/db";
import { ALLOWED_EVENT_TYPES, type AllowedEventType } from "./events";

export interface FunnelSummary {
  since: string | null;
  events: Record<AllowedEventType, number>;
  tripSessions: number;
  affiliateClicks: number | null;
  affiliateClicksPerTripSession: number | null;
}

function affiliateClickTableExists(): boolean {
  const row = getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'affiliate_click'")
    .get();
  return Boolean(row);
}

export function getFunnelSummary(since?: string): FunnelSummary {
  const db = getDb();
  // A single positional param everywhere: no since → match everything.
  const sinceValue = since ?? "0000-01-01";

  const counts = Object.fromEntries(ALLOWED_EVENT_TYPES.map((t) => [t, 0])) as Record<
    AllowedEventType,
    number
  >;
  const rows = db
    .prepare(
      "SELECT event_type, COUNT(*) AS n FROM events WHERE created_at >= ? GROUP BY event_type"
    )
    .all(sinceValue) as Array<{ event_type: string; n: number }>;
  for (const row of rows) {
    if ((ALLOWED_EVENT_TYPES as readonly string[]).includes(row.event_type)) {
      counts[row.event_type as AllowedEventType] = row.n;
    }
  }

  const tripSessions = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT session_id) AS n FROM events
         WHERE event_type = 'trip_created' AND session_id IS NOT NULL AND created_at >= ?`
      )
      .get(sinceValue) as { n: number }
  ).n;

  let affiliateClicks: number | null = null;
  if (affiliateClickTableExists()) {
    affiliateClicks = (
      db.prepare("SELECT COUNT(*) AS n FROM affiliate_click WHERE created_at >= ?").get(sinceValue) as {
        n: number;
      }
    ).n;
  }

  return {
    since: since ?? null,
    events: counts,
    tripSessions,
    affiliateClicks,
    affiliateClicksPerTripSession:
      affiliateClicks === null || tripSessions === 0
        ? null
        : Number((affiliateClicks / tripSessions).toFixed(4)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/analytics/reporting.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Write the failing summary-route test**

```typescript
// src/app/api/analytics/summary/route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

let memDb: Database.Database;
vi.mock("@/lib/db", () => ({ getDb: () => memDb }));

import { GET } from "./route";
import type { NextRequest } from "next/server";

function makeRequest(url: string, token?: string): NextRequest {
  return new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }) as unknown as NextRequest;
}

describe("GET /api/analytics/summary", () => {
  beforeEach(() => {
    memDb = new Database(":memory:");
    memDb.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        trip_id INTEGER,
        session_id TEXT,
        path TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is fail-closed: 404 when ANALYTICS_SUMMARY_TOKEN is not configured", async () => {
    vi.stubEnv("ANALYTICS_SUMMARY_TOKEN", "");
    const res = await GET(makeRequest("http://localhost:3000/api/analytics/summary", "anything"));
    expect(res.status).toBe(404);
  });

  it("rejects a wrong or missing bearer token with 401", async () => {
    vi.stubEnv("ANALYTICS_SUMMARY_TOKEN", "s3cret-token");
    expect((await GET(makeRequest("http://localhost:3000/api/analytics/summary"))).status).toBe(401);
    expect(
      (await GET(makeRequest("http://localhost:3000/api/analytics/summary", "wrong"))).status
    ).toBe(401);
  });

  it("returns the funnel summary for the correct token", async () => {
    vi.stubEnv("ANALYTICS_SUMMARY_TOKEN", "s3cret-token");
    memDb.prepare("INSERT INTO events (event_type, session_id) VALUES ('trip_created', '1')").run();
    const res = await GET(
      makeRequest("http://localhost:3000/api/analytics/summary", "s3cret-token")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.trip_created).toBe(1);
    expect(body.tripSessions).toBe(1);
    expect(body.affiliateClicks).toBeNull();
  });

  it("validates the since parameter", async () => {
    vi.stubEnv("ANALYTICS_SUMMARY_TOKEN", "s3cret-token");
    const res = await GET(
      makeRequest("http://localhost:3000/api/analytics/summary?since=july", "s3cret-token")
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test:unit -- src/app/api/analytics/summary/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 7: Implement the token accessor and the route**

In `src/lib/server-config.ts`, add after `getOpenAIApiKey()`:

```typescript
export function getAnalyticsSummaryToken(): string {
  return readTrimmedEnv("ANALYTICS_SUMMARY_TOKEN");
}
```

Create `src/app/api/analytics/summary/route.ts`:

```typescript
// src/app/api/analytics/summary/route.ts
// Internal reporting endpoint. FAIL-CLOSED: without ANALYTICS_SUMMARY_TOKEN
// configured the endpoint does not exist (404). With it, requires the bearer
// token. Aggregate counts only — no per-user rows ever leave the DB.
// (Non-constant-time token compare accepted for this low-value aggregate
// endpoint — review NIT-6; crypto.timingSafeEqual is the optional swap.)
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSummaryToken } from "@/lib/server-config";
import { getFunnelSummary } from "@/lib/analytics/reporting";

export async function GET(req: NextRequest) {
  const token = getAnalyticsSummaryToken();
  if (!token) return new NextResponse(null, { status: 404 });

  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return new NextResponse(null, { status: 401 });
  }

  const since = new URL(req.url).searchParams.get("since");
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return NextResponse.json({ error: "since must be YYYY-MM-DD" }, { status: 400 });
  }

  return NextResponse.json(getFunnelSummary(since ?? undefined));
}
```

In `.env.example`, append after the `GOOGLE_SITE_VERIFICATION=` line:

```
ANALYTICS_SUMMARY_TOKEN=
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test:unit -- src/app/api/analytics/summary/route.test.ts src/lib/server-config.test.ts`
Expected: PASS (all)

- [ ] **Step 9: Append the analytics sections to `docs/product/ANALYTICS.md`**

Append to the end of the file:

```markdown
## Event definitions (the 7 funnel events, D10 / IMPLEMENTATION_PLAN.md:147)

| event_type | Store | Captured at | meta |
|---|---|---|---|
| `guide_view` | `events` | client beacon — article `[locale]/[slug]`, `/guides`, `/destinations`, `/hot-deals` | `slug` (articles only) |
| `planner_start` | `events` | client beacon — `/planner` page mount | — |
| `trip_created` | `events` | **server-side only** — `POST /api/trips` after INSERT; rejected at the public ingest (`/api/event` accepts only the 5 client types) | `entry_mode` |
| `atlas_health_hidden` | `events` | client beacon — `useAssistantHealth` fresh check resolves unhealthy (once per 45s cache window per tab) | — |
| `atlas_consent` | `events` | client beacon — trigger machine reaches `consented` (`AssistantChat` consent effect) | — |
| `tool_result_rendered` | `events` | client beacon — non-error `[TOOL:...]` SSE frame received in `AssistantChat` | `tool` |
| `affiliate_click` | **`affiliate_click` (Phase 3)** | server-side — Phase 3's `POST /api/affiliate/click` | partner keyed |

Identity: `events.session_id` = `users.id` (guest or authed), resolved **server-side** from the
httpOnly `tpi_guest` cookie / auth session. NOTE the grain difference: Phase 3's
`affiliate_click.session_id` is an Atlas `chat_sessions.id` (TEXT uuid) — a DIFFERENT id
space; `session_id` is a within-table attribute in each store, never a cross-table join key
(see the integration contract below). The client never reads or sends identifiers;
the ingest never sets cookies and is rate-limited per IP (60/min, in-memory). No IP, no
user agent, no fingerprint is stored. `meta_json` and `path` are guarded (key/value
allowform, email + long-digit-run rejection, pathname shape, size caps).

## Access

1. **API (preferred):** `GET /api/analytics/summary` — fail-closed on `ANALYTICS_SUMMARY_TOKEN`.

   ```bash
   curl -s -H "Authorization: Bearer $ANALYTICS_SUMMARY_TOKEN" \
     "https://travelplaninfo.com/api/analytics/summary?since=2026-07-01" | python3 -m json.tool
   ```

2. **Direct SQL** (VPS: `/home/travelplaninfo/nextjs/data/tpi.db`; workstation: `data/tpi.db`):

   ```bash
   # Funnel counts
   sqlite3 data/tpi.db "SELECT event_type, COUNT(*) FROM events GROUP BY event_type;"

   # Trip sessions (distinct sessions that created >=1 trip)
   sqlite3 data/tpi.db "SELECT COUNT(DISTINCT session_id) FROM events WHERE event_type='trip_created' AND session_id IS NOT NULL;"

   # MVP metric — affiliate clicks per trip session (needs Phase 3's affiliate_click table).
   # AGGREGATE ratio: two independent counts, NO join (session_id grains differ across
   # the tables — see the integration contract below; join cross-table on trip_id only).
   sqlite3 data/tpi.db "SELECT (SELECT COUNT(*) FROM affiliate_click) * 1.0 / (SELECT COUNT(DISTINCT session_id) FROM events WHERE event_type='trip_created' AND session_id IS NOT NULL);"

   # Per-trip drill-down (trip_id is the cross-table join key)
   sqlite3 data/tpi.db "SELECT trip_id, COUNT(*) AS clicks FROM affiliate_click GROUP BY trip_id ORDER BY clicks DESC;"
   ```

## Integration contract with Phase 3

**`trip_id` (`trips.id`, INTEGER) is the ONLY cross-table join key** between `events` and
Phase 3's `affiliate_click(id, partner_id, trip_id, session_id, created_at)` — both tables
carry it. `session_id` has a DIFFERENT grain in each table **by design** and is NOT a join
key: `events.session_id` is a `users.id` string (server-resolved, guest or authed), while
`affiliate_click.session_id` is an Atlas `chat_sessions.id` (TEXT uuid, client-supplied) —
each is a within-table attribute only. Never write a query joining the two on `session_id`
(it would silently match nothing).

The MVP metric (`affiliateClicksPerTripSession`) is **defined as an aggregate ratio**:
`COUNT(affiliate_click rows) / COUNT(DISTINCT trip-creating events.session_id)`. The
numerator counts ALL clicks in the window — including clicks from sessions that never
created a trip — and the query performs no session join; per-trip drill-down joins on
`trip_id`. Reporting soft-gates on the `affiliate_click` table's existence and returns
`null` until Phase 3 ships. **No Phase 3 code change is required** (reconciled with the
Phase 3 plan/spec, review HIGH-3, 2026-07-07).

## Notes

- `events` is append-only with no retention job yet — revisit if volume warrants.
- Dashboard UI (self-hosted Plausible/Umami) is **deferred, approval-gated** (O2) — each
  adds a client script, which acceptance IMPLEMENTATION_PLAN.md:154 gates on approval.
```

- [ ] **Step 10: O3 — reconcile `docs/product/VERIFICATION_CHECKLIST.md`**

Replace (lines 194-195):

```
# Example shape; update once event table name is implemented.
sqlite3 data/tpi.db "SELECT * FROM affiliate_click_events ORDER BY created_at DESC LIMIT 5;"
```

with

```
# Canonical names (O3 reconcile, 2026-07-07): funnel events land in `events`
# (Phase 2A); affiliate clicks land in `affiliate_click` (ships with Phase 3).
sqlite3 data/tpi.db "SELECT * FROM events ORDER BY created_at DESC LIMIT 5;"
sqlite3 data/tpi.db "SELECT * FROM affiliate_click ORDER BY created_at DESC LIMIT 5;"
```

Verify: `grep -rn "affiliate_click_events" docs/product/ src/`
Expected: no output. (Scoped to the actual reconcile target, `docs/product/` — the banked spec/plan/review under `docs/superpowers/` quote the old token by necessity and MUST NOT be edited; an unscoped `docs/` grep would trip on them — review BLOCKER-1.)

- [ ] **Step 11: Lint + unit gate**

Run: `npm run lint && npm run test:unit`
Expected: both green.

- [ ] **Step 12: Commit**

```bash
git add src/lib/analytics/reporting.ts src/lib/analytics/reporting.test.ts src/app/api/analytics/summary/route.ts src/app/api/analytics/summary/route.test.ts src/lib/server-config.ts .env.example docs/product/ANALYTICS.md docs/product/VERIFICATION_CHECKLIST.md
git commit -m "feat(analytics): funnel summary reporting, token-gated summary API, documented SQL, O3 naming reconcile"
```

---

### Task 10: E2E spec (cookieless + no-third-party assertions) + full executor gate

**Files:**
- Create: `tests/e2e/analytics.spec.ts` (written here; RUN in Task 11 by the main session — executors never run e2e, per repo convention)
- Test: full gate `npm run lint && npm run test:unit && npm run build`

**Interfaces:**
- Consumes: everything shipped in Tasks 1-9.
- Produces: a Playwright spec asserting the acceptance constraint — the beacon lands (204), the ingest sets no cookie, no third-party tracker host is contacted, no analytics cookie exists in the jar.

- [ ] **Step 1: Write the e2e spec**

```typescript
// tests/e2e/analytics.spec.ts
// Phase 2A acceptance: cookieless, first-party analytics.
// Requires the dev server on http://localhost:3001 (npm run dev -- --port 3001).
// NOTE for maintainers: sendBeacon POSTs surface in Chromium as resource type
// "ping" — Playwright still exposes them via request/response events. If
// req.postData() ever returns null for beacons in a future Playwright, fall
// back to asserting at least one 204 POST /api/event (unit tests already pin
// the event_type payloads).
import { test, expect, type Response } from '@playwright/test';

const THIRD_PARTY_TRACKER =
  /google-analytics|googletagmanager|gtag\/js|plausible\.io|umami|posthog|segment\.(io|com)|mixpanel|hotjar|clarity\.ms|doubleclick|facebook\.net|fbevents/i;

test.describe('first-party analytics (Phase 2A)', () => {
  test('guide view fires a first-party beacon — no cookie set, no third-party tracker', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    const requestUrls: string[] = [];
    page.on('request', (req) => requestUrls.push(req.url()));

    const eventResponsePromise = page.waitForResponse(
      (res: Response) => res.url().includes('/api/event') && res.request().method() === 'POST',
      { timeout: 30_000 }
    );

    await page.goto('/guides', { waitUntil: 'domcontentloaded' });
    const eventResponse = await eventResponsePromise;

    // Ingest accepted the event…
    expect(eventResponse.status()).toBe(204);
    // …and set no cookie (cookieless acceptance).
    const headers = await eventResponse.allHeaders();
    expect(headers['set-cookie']).toBeUndefined();

    // No third-party analytics/tracking host was contacted by the client.
    const offenders = requestUrls.filter((u) => THIRD_PARTY_TRACKER.test(u));
    expect(offenders).toEqual([]);

    // No analytics cookies in the jar (any cookie present must be functional/auth).
    const cookieNames = (await context.cookies()).map((c) => c.name);
    expect(cookieNames.filter((n) => /^(_ga|_gid|_gat|_fbp|ajs_|ph_|mp_)/.test(n))).toEqual([]);
  });

  test('planner fires planner_start', async ({ page, context }) => {
    await context.clearCookies();
    const beaconBodies: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/event') && req.method() === 'POST') {
        beaconBodies.push(req.postData() ?? '');
      }
    });
    await page.goto('/planner', { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => beaconBodies.join('|'), { timeout: 30_000 })
      .toContain('planner_start');
  });
});
```

- [ ] **Step 2: Full executor gate**

Run: `npm run lint && npm run test:unit && npm run build`
Expected: all green. (Do NOT run `npm run test` / `npm run test:e2e` — Playwright needs a live server on :3001 and runs in the main session's Task 11.) If anything fails, stop and report the exact output — do not patch beyond this plan.

- [ ] **Step 3: Grep guards (acceptance-constraint tripwires)**

Run each; expected output as noted:

```bash
# 1. The ingest never creates a guest (never sets cookies) — Task 2's route
#    comment deliberately avoids the helper's literal name (review BLOCKER-1):
grep -rn "getOrCreateGuest" src/app/api/event/            # expected: NO output
# 2. No third-party script loader was introduced anywhere:
grep -rn "next/script" src/                               # expected: NO output
grep -rniE "gtag|googletagmanager|plausible|posthog|umami" src/  # expected: NO output
# 3. O3 reconcile held — scoped to docs/product/: the banked spec/plan/review
#    under docs/superpowers/ legitimately quote the old token (review BLOCKER-1):
grep -rn "affiliate_click_events" docs/product/ src/      # expected: NO output
# 4. All five page beacons wired:
grep -rln "TrackPageView" src/app/ | sort                 # expected: exactly the 5 page files
# 5. No PRODUCTION writer of the Phase 3 table — the reporting unit test's
#    in-memory fixture legitimately seeds it (review BLOCKER-1):
grep -rn "INSERT INTO affiliate_click" src/ | grep -v "\.test\."  # expected: NO output
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/analytics.spec.ts
git commit -m "test(analytics): e2e spec for cookieless first-party acceptance"
```

- [ ] **Step 5: Report**

Report the full gate output verbatim to the orchestrator. Do NOT push or open a PR — branch completion is handled by the main session after Task 11.

---

### Task 11 — MAIN SESSION ONLY: live verification, evidence, STOP gate

**Executor: the main Claude session (NOT a Hermes dispatch).** Follow `superpowers:verification-before-completion` — every claim below needs fresh command output.

- [ ] **Step 1: Start the dev server with test env values**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/tpi-phase2a-analytics
# .env.local is untracked and absent in a fresh worktree — the full e2e suite
# (auth, guest-flow, Atlas specs) and the REQUIRED Atlas smoke need the real
# secrets (review NIT-1):
cp /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype/.env.local .env.local
GOOGLE_SITE_VERIFICATION=tpi-smoke-token ANALYTICS_SUMMARY_TOKEN=smoke-secret npm run dev -- --port 3001
```

(Backgrounded; wait for "Ready".)

- [ ] **Step 2: Full e2e suite**

Run: `npm run test:e2e`
Expected: all green, including the new `analytics.spec.ts` and every pre-existing spec (`guest-flow`, `planner-trust`, `trip-api-dto`, `visual-baseline`, …).

- [ ] **Step 3: GSC meta renders iff the env var is set**

```bash
curl -s http://localhost:3001/ | grep -o 'google-site-verification[^>]*'
# Expected: content="tpi-smoke-token"
```

Then stop the server, restart WITHOUT `GOOGLE_SITE_VERIFICATION`, and:

```bash
curl -s http://localhost:3001/ | grep -c 'google-site-verification'
# Expected: 0
```

Restart with both env vars again for the remaining steps. Also confirm crawler surface:

```bash
curl -s http://localhost:3001/robots.txt        # Expected: Disallow: /api/ + Sitemap: line
curl -s http://localhost:3001/sitemap.xml | head -5   # Expected: valid XML urlset
```

- [ ] **Step 4: Ingest behavioral checks (fresh curl evidence)**

```bash
# Allowed event → 204, and -i shows NO Set-Cookie header:
curl -si -X POST http://localhost:3001/api/event -d '{"event_type":"guide_view","path":"/smoke"}' | head -12
# Disallowed type → 400:
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/event -d '{"event_type":"affiliate_click"}'
# Server-only type forged from a client → 400 (review HIGH-2):
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/event -d '{"event_type":"trip_created"}'
# PII in meta → 400:
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/event -d '{"event_type":"guide_view","meta":{"u":"a@b.com"}}'
# PII in path → 400 (review MEDIUM-1):
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/event -d '{"event_type":"guide_view","path":"/u/a@b.com"}'
# Locale-cookie reality check (the privacy copy discloses a language-preference
# cookie — review MEDIUM-3; either outcome is consistent with the copy):
curl -si http://localhost:3001/es 2>/dev/null | grep -i "set-cookie" || echo "no locale cookie on this negotiation"
```

- [ ] **Step 5: Real-action funnel rows (browser + SQL evidence)**

Browse (Playwright MCP or manually): `/guides`, an article, `/destinations`, `/hot-deals` (the two client-component pages' wiring is otherwise only grep-verified — review NIT-4), `/planner`; create a trip through the UI (or `curl -X POST http://localhost:3001/api/trips -H 'Content-Type: application/json' -d '{"name":"Smoke","destination":"Miami"}'`).

**REQUIRED (review MEDIUM-2, not conditional):** run one live consent → tool-result exchange — real Atlas creds exist and Phase 2 was live-smoke-tested against them. `atlas_consent` and `tool_result_rendered` have no unit/e2e coverage at the component level; this exchange is their only behavioral observation. If Atlas cannot be brought healthy locally, **STOP and record an explicit blocker** (in the session notes + `docs/product/ANALYTICS.md`, mirroring the O1 blocker pattern) — do not silently ship the Atlas-funnel instrumentation unobserved. Then:

```bash
sqlite3 data/tpi.db "SELECT event_type, session_id, trip_id, path, created_at FROM events ORDER BY id DESC LIMIT 16;"
```

Expected: rows for `guide_view` (from article AND `/guides` AND `/destinations` AND `/hot-deals` paths), `planner_start`, `trip_created` (with a numeric `trip_id` and non-null `session_id`); `atlas_consent` + `tool_result_rendered` from the required exchange (or the recorded blocker); `atlas_health_hidden` only if exercised (it cannot co-occur with a healthy consent flow — its deterministic coverage is the 4 unit tests, plus an optional stopped-backend smoke). This is the spec §6 "events land on real actions" gate.

- [ ] **Step 6: Summary endpoint evidence**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/analytics/summary                       # 401 (token set, none provided)
curl -s -H "Authorization: Bearer smoke-secret" http://localhost:3001/api/analytics/summary | python3 -m json.tool  # 200: counts >0, affiliateClicks null
```

- [ ] **Step 7: Console cleanliness**

During Step 5's browsing, capture the browser console: no new errors/warnings from analytics code (spec §4 task 8: "no console error").

- [ ] **Step 8: 🛑 HARD STOP GATE — no VPS deploy without Jose**

**STOP.** Present the evidence bundle (Steps 2-7 outputs) to Jose. VPS prod promote requires Jose's explicit go-ahead **after visual review** (`feedback_no_deploy_without_review`). Do not push to the VPS, do not run the deploy flow, do not merge-and-deploy in one motion. Branch completion (merge/PR) follows `superpowers:finishing-a-development-branch` + Fable diff review per the repo's model-routing habit.

**Non-blocking Jose-provided items (record, don't wait):**
- **O1:** GSC verification token — meta renders nothing until set; console runbook in `docs/product/ANALYTICS.md` is the tracking record.
- **O2:** visual dashboard (Plausible/Umami) — deferred, approval-gated (adds a client script).

- [ ] **Step 9: Post-approval deploy runbook (only after Jose's explicit go)**

```bash
# 1. On the VPS, add to /home/travelplaninfo/nextjs/.env.local:
#      ANALYTICS_SUMMARY_TOKEN=<generate: openssl rand -hex 24>
#      GOOGLE_SITE_VERIFICATION=<Jose's O1 token, when available — optional>
# 2. Deploy (standard flow):
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 \
  "cd /home/travelplaninfo/nextjs && git pull && npm run build && pm2 restart tpi"
# 3. Post-deploy checks:
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://travelplaninfo.com/api/event -d '{"event_type":"guide_view","path":"/deploy-check"}'   # 204
curl -s https://travelplaninfo.com/ | grep -c google-site-verification   # 1 if O1 set, else 0
ssh root@104.225.221.138 "sqlite3 /home/travelplaninfo/nextjs/data/tpi.db \"SELECT event_type, COUNT(*) FROM events GROUP BY event_type;\""
```

- [ ] **Step 10: Pre-written rollback**

The change set is additive (new table, new routes, insert-only edits) — rollback is a code revert; no schema/data migration to reverse.

```bash
# Local branch not yet merged: delete the branch/worktree, main is untouched.
# Merged to main but bad: git revert -m 1 <merge-commit-sha> && git push
# Deployed to VPS and bad:
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 \
  "cd /home/travelplaninfo/nextjs && git reset --hard <pre-deploy-sha> && npm run build && pm2 restart tpi"
# Optional DB tidy-up (harmless to skip — an orphaned events table breaks nothing):
#   sqlite3 data/tpi.db "DROP TABLE IF EXISTS events; DROP INDEX IF EXISTS idx_events_type_created; DROP INDEX IF EXISTS idx_events_session;"
```

Record `<pre-deploy-sha>` (`git rev-parse HEAD` on the VPS) BEFORE step 9's deploy.

---

## Plan-author notes

Candid gaps, risks, and decisions for the adversarial reviewer:

1. **Spec-internal miscount, resolved in favor of coverage.** Spec §4 task 3 originally said "wire the 4 client-only events", but §3.2's own table defines **5** client-beacon events (guide view, planner start, atlas health hidden, atlas consent, tool result rendered; 7 − 2 server-side = 5). Success criterion 2 requires all 7 captured, so this plan wires all 5 client events (Tasks 4-5). *Review MEDIUM-4 confirmed this reading and the spec has been corrected to "5" (§4) with `atlas_health_hidden` added to §6's verification list.*
2. **"Atlas health hidden" semantics are narrower than the name suggests.** The health gate hides the proactive bubble (`AssistantChat.tsx:970`) and consent chip (`:1612`) — the avatar launcher itself stays visible. The event fires when a **fresh** health check resolves unhealthy (both resolved-false and fetch-failure paths), not on 45s-TTL sessionStorage cache reads — so it approximates "sessions that encountered a dead Atlas", undercounting relative to raw pageviews. Documented in ANALYTICS.md; reviewer should confirm this matches the funnel intent.
3. **`tool_result_rendered` fires at frame receipt, not literal DOM paint.** It skips `is_error` frames (mirroring the renderer's `null` return at `AssistantChat.tsx:297`), but counts `no_data` frames (they do render). A user closing the panel mid-stream still counts. Accepted proxy; a paint-accurate hook would require touching the memoized renderer for no funnel benefit.
4. **The two `AssistantChat.tsx` insertions ship without component-level unit tests** — mounting the 1622-line client component needs next-intl provider + portal + SSE scaffolding; the repo has no precedent for it. *Hardened per review MEDIUM-2:* the tool-frame decision is extracted into the pure `getTrackableToolName()` helper with 3 deterministic unit tests (the component insertion is now two lines with no inline `JSON.parse`), and Task 11's consent→tool exchange is **mandatory** (blocker-recorded fallback, not "if healthy"). Remaining residual: the one-line consent insertion itself is observed only by that live exchange.
5. **`POST /api/event` is an open, unauthenticated write endpoint by design** (beacons can't carry secrets). Mitigations: 5-type client allowlist (server-only `trip_created` rejected — HIGH-2), 2KB body cap, meta shape/PII guard, path shape/PII guard, integer-only trip_id, **and a per-IP in-memory rate limit (60/min, 204-and-drop)**. *Correction (review HIGH-1): this note originally claimed "the repo has no shared limiter to reuse" — false; `src/app/api/assistant/chat/route.ts:12-33` contains exactly the in-memory Map pattern, which the Phase 3 review had already ruled mandatory for the sibling `/api/affiliate/click` endpoint (30/min there). Task 2 now copies that pattern at 60/min for cross-thread consistency.* Remaining accepted residual: a distributed flood from many IPs, and the deliberately-not-built optional same-origin check (matching Phase 3's posture — revisit if bot noise appears).
6. **Identity/join contract (amended per review HIGH-3 — the original "pre-answers Phase 3 O3" claim was REFUTED):** `events.session_id` = `users.id` (string), resolved server-side for guests and authed users alike; `trip_created` joins trips by construction. But the banked, already-reviewed Phase 3 plan types `affiliate_click.session_id` as an Atlas `chat_sessions.id` (TEXT uuid, client-supplied) — a **different grain by design** (its review CONFIRMED that attribution model). Resolution (orchestrator decision, 2026-07-07): the cross-table join key is **`trip_id`** — carried by both tables — and `session_id` stays a within-table attribute in each store, never a join key; the MVP metric is an aggregate ratio that joins nothing. ANALYTICS.md's contract section now states this; **no Phase 3 code change is needed** (cross-reference notes added to the Phase 3 plan/spec). Known blur: after guest→account merge, pre-merge events keep the guest's id (orphaned); a fresh visitor with no cookie logs `session_id NULL` on pure page views (their trip-funnel events are unaffected because `POST /api/trips` establishes the guest first). Both accepted as analytics-grade.
7. **GSC token is build-time.** `export const metadata` evaluates at build; a token change on the VPS needs rebuild+restart (documented in the runbook; matches the existing deploy flow). The "renders iff env set" acceptance is proven at two levels: unit (helper) + live curl with/without the var (Task 11 Step 3). DNS-TXT remains the zero-deploy alternative for O1.
8. **Metric definition pinned:** affiliate-clicks-per-trip-session = `COUNT(affiliate_click) / COUNT(DISTINCT session_id WHERE event_type='trip_created')`, returning `null` (never 0 or NaN) when Phase 3's table is absent or the denominator is 0. Spec left the exact denominator open; "distinct trip-creating sessions" was chosen over "distinct trips" (per-trip variant documented as SQL). Per the review's flag-8 adjudication, ANALYTICS.md now states explicitly that the ratio is an **aggregate** — the numerator counts ALL clicks (including from sessions that never created a trip) and no session join exists or is possible (grains differ; see note 6).
9. **Summary endpoint is fail-closed (404 without `ANALYTICS_SUMMARY_TOKEN`)** — stricter than the spec's "small internal endpoint or documented SQL"; both are shipped. Constant-time token comparison was skipped (string `!==`) — timing side-channels on a low-value aggregate endpoint behind fail-closed config didn't justify the ceremony; trivial to swap for `crypto.timingSafeEqual` if the reviewer disagrees.
10. **E2E beacon observability caveat:** Chromium reports `sendBeacon` as `ping`-type requests and Playwright exposes body/response for them, but this has version sensitivity; the spec file carries an explicit fallback note (assert ≥1 204 POST) so a Playwright upgrade can't silently rot the suite's intent.
11. **Privacy copy scope:** the no-IP claim is scoped to the analytics system (the `events` table has no IP/UA column — true by schema). Apache/PM2 access logs still exist server-side, as on any host; the page's §3 speaks to analytics, and §1 was rewritten to cover planner trip data too (previously undisclosed). *Review MEDIUM-3 corrections applied:* the copy says "event-level … reported only in aggregate" (storage is not aggregate), discloses the 7-day guest cookie **pair** (not a singular session cookie), and discloses the `NEXT_LOCALE` language-preference cookie (reality-checked at Task 11 Step 4). Legal fine-tuning is Jose's call.
12. **Retention/pruning deliberately deferred** — `events` is append-only; at TPI's traffic this is years of headroom in SQLite. Noted in ANALYTICS.md rather than building a cron now (YAGNI).
13. **Naming risk — `events` is a generic table name.** Checked: `data/tpi.db` has no existing `events` table and `src/` has no competing symbol; Phase 3's spec references `affiliate_click` separately. If a future phase wants domain event sourcing, this table is purely analytics — the ANALYTICS.md header says so.
14. **`docs/product/ANALYTICS.md` doubles as IMPLEMENTATION_PLAN Phase 2A task 6** ("Document setup and access location") and the sitemap-submission capture point (acceptance: "Sitemap submission status captured") — the runbook has a literal fill-in line for the submission date/status.




