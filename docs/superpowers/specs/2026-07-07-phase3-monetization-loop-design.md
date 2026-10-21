# Phase 3 — Truthful Planner Monetization Loop (Design)

**Date:** 2026-07-07
**Status:** Design approved (Jose, 2026-07-07, remote). Implementation deferred — this is a *banked* spec/plan pair. Impl prerequisite: Phase 2 deployed and live on the VPS (Phase 2 is merged at `main`/`4d5a1e7` but not yet deployed — VPS secrets pending).
**Repo:** `travelplaninfo-prototype` (`main` @ `4d5a1e7`)
**Executes decisions:** D3 (no fabricated inventory → partner-search handoff), D7 (one affiliate set everywhere), D8 (Phase 1→2→3 ordering), H6 (two-tier capability-driven affiliate opener).

---

## 1. Goal & success criteria

Make the **guide → planner → Atlas → itinerary → affiliate-click** loop **truthful** (D3: zero fabricated hotel/activity/restaurant names, ratings, or prices anywhere) and **measurable** (server-side click counting tied to trip/session), governed by **one affiliate source of truth** (D7) with correct FTC disclosure (`rel="sponsored"`).

**Success criteria:**
1. `src/config/affiliates.ts` contains Klook, Tiqets, Kiwi.com, Kiwitaxi + the existing CJ set — the single partner source of truth (D7). **Definition of done (review HIGH-2):** Tiqets/Kiwi.com/Kiwitaxi registered-but-disabled (`enabled:false`, no buildable URL) IS done for this phase; their live links are a tracked follow-up (O4) — resolvable in-session via the TP API (optional plan Task 4b) or later from Jose's Travelpayouts dashboard ids.
2. Zero D3-forbidden fabricated specific names/ratings/prices render on any surface (Atlas chat, Path A/B modal, itinerary).
3. Every outbound **affiliate** anchor carries `rel="sponsored"` (plus `noopener noreferrer`); non-affiliate links (Google Maps, internal) do not.
4. A guest hotel/activity handoff renders as a minimal, no-inventory CTA card with a real partner link.
5. Affiliate clicks are counted server-side, keyed by partner + trip/session. **Scope (review MEDIUM-1):** counting covers the `AffiliateLink`-rendered Atlas-loop surfaces (atlas flight/deal cards, modal flights tab, destinations flight CTAs, partner-handoff CTA); other rel-compliant surfaces (TripModes cruise links, destinations hotel/car anchors, planner sidebar, hot-deals, banners, inline prose links) stay rel-only this phase, and middle-click/context-menu opens are not logged — the count is a floor, not a census.
6. AirAdvisor sends no non-earning traffic (flagged off until an approved CJ URL exists).
7. `npm run test:unit` + `npm run test:e2e` green; `no-fabrication` guard extended; live guest-journey smoke passes.

---

## 2. Current state (ground truth, 2026-07-07 sweep)

- **`src/config/affiliates.ts` (215 lines)** — heterogeneous, no unified schema. `CJ_LINKS` (builder fns, hardcoded CJ URLs, publisher `101692716`), `TP_CONFIG` (flights, marker `164743`), `TP_KLOOK` (Klook via `tp.media` `p=4110&trs=500721&marker=164743`), `AffiliateDeal`/`DEALS[]`, `CJBanner`/`CJ_BANNERS[]`. Richest schema-like shape is the `Recommendation` interface in `AffiliateRecommendations.tsx:8-17` (`affiliate_program` field ≈ "partner").
- **Tiqets / Kiwi.com / Kiwitaxi — absent** from config (matches D7). They appear only as: article prose (`content/articles/travel-planning-guide.json`), an **orphan** `TransferCard.tsx` (`kiwitaxi`, zero importers), and a test guard (`system-prompt.test.ts:27-30`).
- **Partner-search handoff (D3)** produced in `src/lib/atlas/system-prompt.ts` `buildPartnerLinkInstructions(destination)` (62–78): Atlas ends its reply with exactly one ready-made markdown link — Hotels.com (`CJ_LINKS.hotelsCity`), Klook (`TP_KLOOK.url`), or Google Maps (no affiliate program). Prose-only + omit links when no destination is resolvable. **No handoff *card* exists** (task 2 unbuilt).
- **Tool loop** `src/lib/atlas/tool-loop.ts` exposes only 4 real-data tools (`search_flights`, `get_deals`, `get_article`, `surprise_me`). No hotel/activity/restaurant tool (removed under D3; guarded by `no-fabrication.test.ts:9-14`).
- **Rendering** `src/components/AssistantChat.tsx`: tool frames → cards (`FlightCard`, `DealCard`, `DestinationCard`, `ArticleCard`); prose links via `renderMarkdownLite()` → `<a target="_blank" rel="noopener noreferrer">` at **line 404** (no `sponsored`).
- **`rel="sponsored"` gaps** (task 5): article/planner surfaces mostly compliant. Missing on: `atlas/FlightCard.tsx:46`, `atlas/DealCard.tsx:31`, `atlas/HotelCard.tsx:47` (latent), `atlas/TripResultsModal.tsx:588,700`, `AssistantChat.tsx:404` (all prose links incl. D3 handoffs — highest value), `destinations/page.tsx:286,326` (flight links, while hotel/car beside them have it), `TripModes.tsx:57`. `rel="nofollow"` used nowhere.
- **Dead D3-forbidden paths** (task 1): `AssistantChat.tsx` retains normalization (197–241) + card branches (310–374) for `search_hotels/activities/restaurants` → `HotelCard`/`ActivityCard`/`RestaurantCard` with invented `name`/`rating`/`price_night`. Latent (no tool emits) but forbidden shapes. `atlas/types.ts` still defines `HotelResult`/`ActivityResult`/`RestaurantResult` with `rating`, `price_night`.
- **`TripResultsModal` (Path A/B)** renders hotel cards with `name`/`rating`/`price_night` + `book_url` (588/700). Empty under the 4-tool brain but the code path is intact — latent fabrication + missing-`sponsored` surface.
- **AirAdvisor**: `affiliates.ts:29-31` returns the raw site URL (`airadvisor.com/en/flight-compensation`, non-earning) with a TODO; also in `system-prompt.ts:113`. CJ program status "New".
- **H6 / centralized opener**: greenfield. No `openAffiliate()`, no `embedMode`. Only `AffiliatePreviewModal.tsx` (interstitial preview with a real outbound `<a>`, not an iframe).
- **Orphan dispatchers** (dormant): `TransferCard`/`CarRentalCard`/`ActivityCard` dispatch `open-affiliate-modal` CustomEvents that nothing listens for; zero importers.
- **Tests:** `test:unit`=vitest, `test:e2e`=playwright, `test`=both.

---

## 3. Design — architecture

Additive, not a rewrite. The existing `CJ_LINKS`/`TP_*` builders keep working; new metadata + a centralized opener layer on top, and high-value render sites migrate onto it first.

### 3.1 `PARTNERS` registry (in `affiliates.ts`)
A typed registry keyed by partner id:
```
interface Partner {
  id: string;              // 'hotels_cj' | 'aviasales' | 'klook' | 'tiqets' | 'kiwi' | 'kiwitaxi' | 'airadvisor' | ...
  network: 'cj' | 'travelpayouts';
  label: string;           // display, e.g. 'Hotels.com'
  embedMode: 'newtab';     // see 3.3 — all current partners are newtab
  rel: 'sponsored';        // affiliate → always 'sponsored noopener noreferrer'
  buildUrl: (params) => string;  // wraps the existing CJ_LINKS/TP_* builders
  enabled: boolean;        // AirAdvisor starts false (see task 6)
}
```
Tiqets / Kiwi.com / Kiwitaxi get real registry entries — but NOT live links at registration time (review HIGH-2 corrected this section's original wording, which was factually impossible): `travelpayouts.json` confirms only the shared marker `164743` and TPI traffic-source `trs=500721`, and the repo confirms per-program `campaign_id`/`p` ids for Klook alone (`137`/`4110`). The three partners therefore register `enabled:false` with `buildUrl → ""` — unrenderable and unopenable by construction — until real ids are obtained: fetched from the TP API (optional plan Task 4b, main session) or generated by Jose in the Travelpayouts dashboard (O4). MEMORY affiliate rules bind throughout: never `p=4001`, never append params to `tpx.li`, never invent ids. The registry is the D7 single source of truth.

### 3.2 Centralized opener + link component
- **`openAffiliate(partnerId, { params, tripId, sessionId })`** — resolves the partner, fires the server-side click log (3.4), then navigates per `embedMode` (new tab today). One choke point for tracking + `rel` + future iframe.
- **`<AffiliateLink partnerId params>`** — renders `<a href={buildUrl} rel="sponsored noopener noreferrer" target="_blank" onClick={log}>`. All migrated render sites use this so `rel` and tracking are set once, not scattered.

### 3.3 `embedMode` (H6)
Metadata supports `'iframe' | 'newtab'`, but **every current partner is `'newtab'`** — Hotels.com/Aviasales/Klook/Tiqets/Kiwi all block iframing via `X-Frame-Options`/CSP. No iframe path is built now; the field exists so a future embeddable-widget partner is a one-line flip, not a refactor.

### 3.4 Server-side click counting (task 7)
`POST /api/affiliate/click` → SQLite `affiliate_click(id, partner_id, trip_id, session_id, created_at)` in the existing `data/tpi.db`. Fired through the client choke points (`<AffiliateLink>` onClick / `openAffiliate()`) as a fire-and-forget beacon (best-effort, non-blocking — a failed log never blocks the outbound nav). The endpoint stays unauthenticated (guest clicks must count) but is hardened because a trustworthy click count IS this phase's deliverable (review HIGH-1): `partner_id` is validated with `Object.hasOwn` against the `PARTNERS` registry (never the prototype-walking `in` operator), disabled partners are rejected (no UI surface can produce such a click — the rows would be synthetic), and writes are rate-limited per IP with the chat route's in-memory pattern — throttled requests still answer `{ ok: true }` so beacons never break. Phase 2A analytics consumes this table later (noted overlap; not built here). Cross-plan join contract (Phase 2A review HIGH-3, 2026-07-07): Phase 2A's MVP metric joins this table to its `events` table on `trip_id` only — `session_id` grains intentionally differ (`chat_sessions.id` uuid here vs `users.id` in `events`) and are never a cross-table join key; no change needed in this phase.

### 3.5 `rel="sponsored"` by host (task 5)
- `AffiliateLink` always emits `sponsored noopener noreferrer`.
- The two scattered card + modal sites migrate to `AffiliateLink` (or, minimally, get `sponsored` added): `FlightCard`, `DealCard`, `TripResultsModal` flight+hotel links, `destinations/page.tsx:286,326`.
- **Prose handoff links** (`AssistantChat.tsx` `renderMarkdownLite`, line 404): patch the renderer to add `rel="sponsored noopener noreferrer"` **for known-affiliate hosts only** — `hotels.com`/CJ, `tp.media`/Klook, `aviasales`, `tiqets`, `kiwi.com`, `kiwitaxi`. Google Maps and internal links keep `noopener noreferrer` only. (Host allowlist, not blanket, so we never mislabel a non-affiliate link.)

### 3.6 D3 truthfulness (tasks 1, 2)
- **Delete** the dead fabricated-inventory paths: `AssistantChat.tsx` `search_hotels/activities/restaurants` normalization + `HotelCard`/`ActivityCard`/`RestaurantCard` render branches; the `HotelResult`/`ActivityResult`/`RestaurantResult` types with `rating`/`price_night` in `atlas/types.ts`. Extend `no-fabrication.test.ts` to assert these render branches/types cannot silently return.
- **Extend the same cleanup to `TripResultsModal`** (Path A/B) — remove/neutralize the latent `name`/`rating`/`price_night` hotel-card fabrication shapes there too (D3 is universal). *Approved 2026-07-07; flag reverses only if Jose later wants it deferred to a Path-A/B pass.*
- **Handoff CTA card (task 2):** a new minimal `PartnerHandoffCard` — a styled CTA button (`Search hotels in {city} on Hotels.com →`) with **no** invented names/ratings/prices. **Mechanism (chosen):** the prose renderer in `AssistantChat.tsx` detects the single known-affiliate handoff link (Hotels.com / Klook host) that `buildPartnerLinkInstructions` already emits and *promotes* it from an inline `<a>` to `PartnerHandoffCard`. This leaves the brain/system-prompt and tool loop untouched (lowest blast radius) and shares the same code site as the §3.5 rel-by-host patch. *Rejected alternative:* a dedicated `[TOOL:partner_handoff]` frame — cleaner data shape but requires touching the system prompt + tool loop for no D3 or CTR benefit. Purely a styled affiliate link; higher CTR than inline prose; D3-safe by construction.

### 3.7 AirAdvisor (task 6)
**Flag OFF until approved** (Jose, 2026-07-07). Set `enabled:false` in the registry; remove the raw non-earning URL from `system-prompt.ts:113` and stop rendering the AirAdvisor rec in `AffiliateRecommendations.tsx`. A single `enabled` flip + real CJ `buildUrl` turns it back on when Jose supplies the approved tracking URL (open question O1).

---

## 4. Task breakdown (maps to IMPLEMENTATION_PLAN Phase 3, tasks 1–8)

1. **D3 data/UI cleanup** — remove dead fabricated-inventory paths (AssistantChat + types), extend to TripResultsModal; extend `no-fabrication.test.ts`.
2. **Partner-handoff CTA card** — new `PartnerHandoffCard`, wired into the Atlas render path; no invented inventory.
3. **Add Tiqets / Kiwi.com / Kiwitaxi** to `affiliates.ts` under the new `PARTNERS` registry (D7).
4. **`PARTNERS` metadata + `openAffiliate()` + `AffiliateLink`** — centralized opener/tracker; `embedMode` newtab-default (H6).
5. **`rel="sponsored"` fix** — host-based, via `AffiliateLink` + prose-renderer patch; close every gap in §2.
6. **AirAdvisor** — flag off (registry `enabled:false`, strip non-earning links).
7. **Server-side click counting** — `/api/affiliate/click` + `affiliate_click` table, fired through the `AffiliateLink`/`openAffiliate` choke points; endpoint hardened per §3.4.
8. **Verify full guest journey** — live smoke (guest → trip → Atlas consent → real card + real affiliate link w/ `sponsored` + click row), production.

---

## 5. Out of scope
- Phase 2A analytics dashboard/GSC (separate spec; consumes `affiliate_click`).
- Any iframe/embed partner integration (metadata only; no partner supports it today).
- Rewriting the existing compliant article/planner affiliate render sites that already carry `sponsored` (leave working code alone; migrate opportunistically only where task 5 requires).
- Removing the orphan `open-affiliate-modal` dispatchers / dead `TransferCard`/`CarRentalCard` (dormant, zero importers) — note for a later dead-code pass unless they collide with task 4.

---

## 6. Verification bar + rollback
- **Gates:** `npm run lint` (no new errors), `npm run test:unit`, `npm run test:e2e`, `npm run build` clean.
- **D3 guard:** extended `no-fabrication.test.ts` proves fabricated shapes can't render.
- **`rel` audit:** a test/grep asserting every affiliate anchor carries `sponsored` and no non-affiliate link does.
- **Click log:** a real click produces one `affiliate_click` row keyed by trip/session.
- **Live guest-journey smoke** (workstation-independent, post-Phase-2-deploy).
- **Rollback:** feature branch; additive registry means the old builders still work if the migration is reverted mid-flight. Hard STOP-gate before VPS prod promote.

---

## 7. Open questions
- **O1 (AirAdvisor CJ URL):** Jose to supply the approved CJ tracking URL when the program clears "New"; until then `enabled:false`. Non-blocking (default handles both).
- **O2 (iframe embed):** revisit `embedMode:'iframe'` per-partner only if a partner offers an embeddable widget. Deferred.
- **O3 (click attribution):** best-effort trip/session keying — confirm the session id available at the Atlas/planner render layer maps to the same id used by trip persistence. Resolve during planning.
- **O4 (Tiqets/Kiwi.com/Kiwitaxi Travelpayouts ids):** their per-program `campaign_id`/`p` pairs exist neither in the repo nor in `travelpayouts.json` (only Klook's `137`/`4110` do). The partners register `enabled:false` + `buildUrl → ""` — unrenderable and unopenable by construction — until real ids arrive: fetched from the TP API (optional plan Task 4b, main session) or generated by Jose (TP dashboard → Tools → Link generator, site travelplaninfo.com / trs `500721`). Non-blocking; go-live is paste-ids + flip `enabled`. Never guess ids (the `p=4001` incident).

---

## 8. References
- `docs/DECISIONS.md` — D3, D5 (locale, *not* handoffs), D7, D8, H3, H6.
- `docs/product/IMPLEMENTATION_PLAN.md:156-182` (Phase 3 task list, acceptance).
- MEMORY affiliate rules: TPI TP set (Klook, Tiqets, Kiwi.com, Kiwitaxi); Hotels.com(CJ) primary hotel; marker `164743`; never `p=4001`, never append params to `tpx.li`.
- Prior loop shape: `docs/superpowers/plans/2026-07-05-atlas-brain-relocation-phase2.md`, `2026-07-06-atlas-review-fixes.md`.
