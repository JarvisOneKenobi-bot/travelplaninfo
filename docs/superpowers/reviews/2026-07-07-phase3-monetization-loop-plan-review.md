# Adversarial Plan Review — Phase 3 Truthful Planner Monetization Loop

**Reviewer:** Fable 5 (independent; did not author the spec or plan)
**Date:** 2026-07-07
**Spec:** `docs/superpowers/specs/2026-07-07-phase3-monetization-loop-design.md`
**Plan:** `docs/superpowers/plans/2026-07-07-phase3-monetization-loop.md`
**Repo baseline verified:** `main` @ `4d5a1e7`

---

## Verification method

Every load-bearing repo claim in the plan was checked against the actual tree, not taken on trust. Results:

| Claim | Verified |
|---|---|
| `AssistantChat.tsx` anchors: `TRIP_TOOLS`:24, `ModalData`:57–63, `extractTripData`:162–245, card branches 310–374, `escapeHtml`:386–393, `renderMarkdownLite`:395–465 (link replace 401–405), `sessionStorage["atlas_session_id"]` set at :559, `setModalData` ~1122–1131 / ~1392–1401, `allTrips` 1501–1588, modal invocation 1595–1609, `buildAutoSearchPrompt` ~500, exactly four `renderMarkdownLite` call sites | ✅ all exact |
| `TripResultsModal.tsx` 1048 lines; flight anchor 585–595 (`rel` at :588), hotel anchor 697–707 (`rel` at :700); TABS/state/summary/`handleAddAll` shapes as described | ✅ exact |
| `affiliates.ts`: `CJ_LINKS`/`TP_CONFIG`/`TP_KLOOK`/`DEALS`/`CJ_BANNERS`, `export default CJ_LINKS` final line, AirAdvisor raw URL :29–31, Klook `campaign_id=137&p=4110&trs=500721&marker=164743` | ✅ (file is 215 lines, not 216 — harmless) |
| `system-prompt.ts`: `buildPartnerLinkInstructions` 62–78 emits exactly-one trailing markdown link (Hotels.com dpbolvw / Klook tp.media / Google Maps); AirAdvisor rule at :113 (the only `airadvisor` hit in `src/lib/atlas/`) | ✅ |
| `no-fabrication.test.ts` = 3 pre-existing cases; `system-prompt.test.ts:27–31` Tiqets/Kiwitaxi guard | ✅ |
| Sole importers: `TripResultsModal` → AssistantChat; atlas `HotelCard`/`ActivityCard`/`RestaurantCard` → AssistantChat; `FlightCard`/`DealCard` → AssistantChat → deletions/migrations have no other consumers | ✅ |
| The complete set of plain `rel="noopener noreferrer"` tsx anchors is 9 hits and maps 1:1 onto Tasks 5/6/7 (HotelCard:47, destinations:286+326, TripModes:57, AssistantChat:404, DealCard:31, FlightCard:46, TripResultsModal:588+700) — Task 10's "no output" grep is exhaustively achievable | ✅ |
| `vitest.config.ts` jsdom + `@vitejs/plugin-react` + `src/**/*.test.{ts,tsx}`; `@testing-library/react`/`jsdom` installed; `playwright.config.ts` baseURL `:3001` with **no `webServer`** (executor e2e ban is justified); `spend.test.ts` mock convention exists verbatim | ✅ |
| `db.ts`: `getDb()`, `assistant_cost` block ends :129–130; `chat_sessions.id` TEXT / `trips.id` INTEGER (Task 1 schema types correct); `#atlas-trip-context` emitted by `planner/[tripId]/page.tsx:171` with `tripId: trip.id` (number) → the O3 DOM fallback works | ✅ |
| `escapeHtml` escapes `&(quot) < > " '` **before** any markup is built; link regex admits only `https?://` or `/`-relative → escape-first XSS posture holds (see flag 14) | ✅ |
| SSE: `sse.ts` multi-line `decodeSseData` and `parseMessageContent` brace-counting untouched by any task → `[TOOL:...]` contract and Phase-2 framing fix preserved | ✅ |
| e2e suite: no spec asserts the Hotels/Activities/Restaurants tabs, TripResultsModal, or the inline handoff link; `visual-baseline.spec.ts` screenshots only `/planner/[tripId]` | ✅ |
| `scripts/deploy-vps.sh` exists; middleware matcher excludes `/api`; chat route has the in-memory rate-limit pattern note 4 refers to; orphan `TransferCard`/`CarRentalCard`/`ActivityCard` (non-atlas) exist with zero `open-affiliate-modal` listeners | ✅ |
| `help-content.ts`: "Auto-search"/"Trip Results Modal"/"Day assignment" (:37/:39/:40) and the exact "Atlas chat" phrase Task 8 rewrites (:44) all exist | ✅ |

---

## Findings (severity-ranked)

### BLOCKER-1 — Task 7's prescribed code fails Task 7's own prescribed tripwire tests (deterministic, halts the pipeline)

**Where:** Plan Task 7 Step 1 (tripwire tests) vs Task 7 Step 3.2 (TRIP_TOOLS replacement) and Step 4 (types.ts rewrite). Cascades into Task 7 Step 7's grep expectation and Task 10 Step 2's grep guards.

**Defect:** The tripwires are raw `String.includes` checks on file contents, and the plan's own replacement code embeds the forbidden tokens in comments:

1. The prescribed `TRIP_TOOLS` comment reads "`search_hotels / search_activities / search_restaurants are D3-forbidden…`" — but the tripwire asserts `AssistantChat.tsx` does **not** contain `"search_hotels"`, `"search_activities"`, `"search_restaurants"`.
2. The prescribed `types.ts` header comment reads "`The HotelResult / ActivityResult / RestaurantResult types … were removed`" — but the tripwire asserts `types.ts` does **not** contain `"HotelResult"`, `"ActivityResult"`, `"RestaurantResult"`.

Consequences, all deterministic:
- Task 7 Step 7 (`no-fabrication.test.ts` expected PASS 7/7) fails on 2 of the 4 new cases.
- Task 7 Step 7's `grep -rn "HotelResult\|…" src/` ("hits ONLY inside no-fabrication.test.ts") gets a hit in `types.ts`.
- Task 10 Step 2's `grep -rn "search_hotels\|…" src/ | grep -v no-fabrication.test` ("no output") gets a hit in `AssistantChat.tsx`.
- The executor's standing instruction is "if a verification command fails, stop and report — do not guess a fix" → guaranteed mid-run halt on the largest task.

**Fix (small, must be applied to the plan before execution):** Reword both comments so no forbidden token appears literally, e.g.
- TRIP_TOOLS: `// Only real-data tools may trigger the trip-results flow. The three fabricated-inventory search tools (hotels/activities/restaurants) are D3-forbidden and must never be re-added (guarded by no-fabrication.test.ts). …`
- types.ts: `/** … The fabricated hotel/activity/restaurant result types (invented names, star counts, nightly prices) were removed in Phase 3 … */`
The tripwires and grep guards then hold as written.

---

### HIGH-1 — `POST /api/affiliate/click` can be trivially spammed AND its partner validation is buggy; the phase's headline metric is unprotected

**Where:** Plan Task 3 (route code + Interfaces), spec §3.4; adjudicates plan-author note 4.

Two distinct problems:

**(a) Validation bug in the prescribed code.** `if (typeof partner_id !== "string" || !(partner_id in PARTNERS))` — the `in` operator walks the prototype chain, so `partner_id: "toString"`, `"constructor"`, `"hasOwnProperty"`, `"valueOf"`, etc. pass validation and insert junk rows, directly contradicting the route's own comment ("validated against the PARTNERS registry so arbitrary strings can't pollute the table"). **Fix:** `Object.hasOwn(PARTNERS, partner_id)`. Also consider rejecting (or at least flagging) `enabled:false` partners — no UI surface can produce such a click, so any `airadvisor_cj`/`tiqets`/`kiwi`/`kiwitaxi` row is synthetic by definition.

**(b) Abuse blast radius of the unauthenticated, unthrottled endpoint.** Best-effort *logging* is the right call (a failed log must never block navigation, and `sendBeacon` can't carry auth), and unauthenticated is correct (guest clicks must count). But unthrottled *writes* are not acceptable here, because a trustworthy click count IS this phase's deliverable (spec success criterion 5) and the sink is the same single SQLite file (`data/tpi.db`) that serves trips/chat/auth. Blast radius: (i) any bot inflates the MVP metric arbitrarily → Phase 2A analytics reads garbage; (ii) unbounded inserts at network speed grow the production DB file (WAL) — a disk-pressure/DoS vector on the VPS; (iii) trust in the number Jose makes decisions with is silently destroyed.

**Adjudication of author flag 4: CONFIRM as must-fix, not "acceptable".** The author already identified the cheap, in-pattern hardening: the chat route's in-memory rate limiter (`src/app/api/assistant/chat/route.ts:10–31`, per-key, 10/min) — reuse it keyed by IP (`x-forwarded-for` first hop) at something like 30/min, return `{ok:true}` on throttle (don't 429 a beacon), plus an optional soft same-origin check (drop the insert when an `Origin`/`Referer` is present and isn't ours). ~15 lines; add one unit test. This does not add auth, cookies, or friction to guest clicks.

---

### HIGH-2 — O4 (Tiqets/Kiwi.com/Kiwitaxi ids): `enabled:false` is the RIGHT handling, but the partial completion of D7 must be stated in the spec's success criterion, and the plan forgoes an id-resolution path it names itself

**Where:** Plan Task 4, Global Constraints, author note 1; spec §3.1 + success criterion 1.

**Adjudication of author flag 1: CONFIRM (real; correctly handled; two required edits).**

- **`enabled:false` vs blocking:** correct. The never-invent rule is well-founded (the `p=4001` incident 400s at click time), `~/.openclaw/credentials/travelpayouts.json` genuinely lacks per-program campaign ids (author's sweep matches what the repo shows — only Klook's `137/4110` exist, in `affiliates.ts:47`), and `buildUrl → ""` + `enabled:false` + the Task 4 tests make a non-earning link *unrenderable and unopenable by construction*. Blocking the whole phase on a dashboard errand would serialize unrelated work for no safety gain.
- **Unmissability:** adequate — the handoff to Jose appears in Global Constraints (HARD RULE), the `TP_PROGRAM_IDS` comment, the Task 4 tests' names, author note 1, and Task 11 Step 4 explicitly presents "the O4 open item" at the STOP gate. No change needed there.
- **D7 intent:** registering them disabled satisfies criterion 1's literal wording ("`affiliates.ts` contains Klook, Tiqets, Kiwi.com, Kiwitaxi + the existing CJ set") but NOT spec §3.1's stronger sentence ("buildUrl using their Travelpayouts/CJ params — exact tracking params confirmed against `travelpayouts.json`…"), which turned out to be factually impossible — the ids aren't in that file. This deviation currently lives only in an author note. **Required edit 1:** amend spec §3.1 + success criterion 1 (or add a "Definition of done" line in the plan Goal) to state plainly: *D7 completes in registered-but-disabled form; live links for the three partners are a tracked follow-up (O4) requiring ids from the Travelpayouts dashboard.* Partial completions must be visible where the success criteria are read, not only in the appendix.
- **Required edit 2 (improvement, not safety):** author note 1 concedes the ids "could alternatively be fetched via `generate_tp_links.py` against the TP API before implementation — I did not run it (plan-author role is read-only)". The *main session* is not read-only. Add an optional Task 4b (MAIN SESSION, not Hermes — credentials access): run `command-post/generate_tp_links.py` for site travelplaninfo.com / `trs=500721`, and if it yields the three `campaign_id`/`p` pairs, paste them + flip `enabled` + re-verify the Task 4 tests (updating the two `enabled:false` assertions). These are already-approved TPI programs per the MEMORY affiliate rules, and API-fetched ids are ground truth, not guesses — fully compliant with the never-invent rule. This converts "wait for Jose" into "run a script", potentially shipping the phase with all four TP partners live. Fallback remains `enabled:false`.

---

### MEDIUM-1 — The click metric's coverage is narrower than success criterion 5 reads, and one in-plan surface gets `rel` but never logs

**Where:** Plan Tasks 3/6, author notes 3 and 6; spec success criterion 5 ("Affiliate clicks are counted server-side").

What actually logs after this plan: `AffiliateLink`-rendered anchors only — atlas `FlightCard`, `DealCard`, TripResultsModal flights tab, the two destinations-page flight CTAs, `PartnerHandoffCard`. What carries `sponsored` but never logs: **`TripModes` CJ cruise deep links** (Task 6 fixes them with a bare `rel` ternary, no `AffiliateLink`), destinations hotel/car anchors, the planner sidebar (`AffiliateRecommendations`/`AffiliatePreviewModal`), `hot-deals`, banners, and any *inline* (non-trailing) prose affiliate link inside `dangerouslySetInnerHTML`. Additionally, middle-click / context-menu-open bypasses `onClick` on even the migrated anchors (inherent to the beacon approach; fine, but it means the counter is a floor, not a census).

Author flag 3: **CONFIRM the design** (DOM-fallback attribution is sound — verified `sessionStorage["atlas_session_id"]` and the numeric `tripId` in `#atlas-trip-context` both exist as claimed) — but the accepted gaps should be visible at the success-criteria level. **Fix:** (1) add one sentence to the plan Goal/Task 11 evidence list: *"click counting covers the Atlas-loop surfaces (cards + handoff CTA + destinations flight CTAs); other compliant surfaces are rel-only in this phase"*; (2) either migrate the `TripModes` cruise link onto `AffiliateLink partnerId="cruisedirect_cj" href={…}` (cheapest way to remove the inconsistency — the href is a pre-built CJ deep link, so the `href` prop path fits) or list TripModes explicitly among the not-counted surfaces in note 3b.

### MEDIUM-2 — `openAffiliate()` ships unused and untested

**Where:** Plan Task 3 (`affiliate-opener.ts`); spec §3.2.

No task ever calls `openAffiliate` — every migrated site uses `<AffiliateLink>`, whose `onClick` calls `logAffiliateClick` directly. The function exists only because spec §3.2 names it, and it ships with zero test coverage (the Task 3 suite tests only the component). Untested prescribed code that nothing exercises is where regressions hide. **Fix:** either (a) add 2 unit tests (disabled partner → no `window.open`, no beacon; enabled → logs once then opens with `"noopener,noreferrer"`), or (b) drop `openAffiliate` from this phase and let `AffiliateLink` be the sole choke point, amending spec §3.2. (a) is the smaller edit.

### MEDIUM-3 — The O3 attribution fallback test asserts nothing about attribution

**Where:** Plan Task 3 Step 1, test `"falls back to sessionStorage atlas_session_id for attribution (O3)"`.

The test seeds `sessionStorage` and then asserts only `sendBeacon` was called once — it never inspects the payload, so it would pass even if the fallback were deleted. The one mechanism resolving spec open question O3 is effectively unpinned. **Fix:** assert the payload — e.g. delete `navigator.sendBeacon` in that test so the `fetch` fallback path runs and its JSON body can be asserted (`session_id: "sess-from-storage"`), or `await (sendBeacon.mock.calls[0][1] as Blob).text()` and parse. Same for a `#atlas-trip-context` trip-id fallback case, which currently has no test at all.

### MEDIUM-4 — `hosts` arrays conflate boolean classification with partner ownership; CJ domains are shared across programs

**Where:** Plan Task 2 `PARTNERS.hosts` + Task 8 `extractPartnerHandoff`.

Facts from `affiliates.ts`: `dpbolvw.net` serves Hotels.com links AND two CruiseDirect deep links (`cruisesFamily`, `cruisesCelebrity`) AND a CruiseDirect banner; `jdoqocy.com` serves Vrbo AND EconomyBookings `cars()`; `tkqlhce.com`/`anrdoezrs.net` serve CruiseDirect AND `carsCompare`/a cars banner. The per-partner `hosts` assignments in Task 2 are therefore not ownership facts. This is *functionally harmless today* — `isAffiliateHost` is a union (all CJ hosts classify true regardless of which entry lists them), and `extractPartnerHandoff` promotes only trailing dpbolvw→`hotels_cj` / tp.media→`klook`, which matches the only links `buildPartnerLinkInstructions` can emit. But the moment anyone reverse-maps URL→partner for attribution (a natural Phase 2A move), dpbolvw clicks would all be booked as `hotels_cj` even when they're cruise links. **Fix:** one sentence on the `hosts` field doc: *"classification-only for `isAffiliateHost`; CJ domains are shared across programs — never reverse-map host→partner"*; keep `extractPartnerHandoff`'s hardcoded mapping (correct because the system prompt constrains what Atlas emits — verified at `system-prompt.ts:62–78`).

### NIT-1 — `affiliates.ts` is 215 lines, not 216
Task 2's "(216 lines)" is off by one. Harmless — the insertion anchor is the `export default CJ_LINKS;` text, not a line number.

### NIT-2 — `help-content.ts` "Adding items" entry (:38) still says "partner search **link**" after Task 8
Task 8 rewords only the "Atlas chat" entry (:44, link→button). The "Adding items" entry (:38) contains the same "plus a trusted partner search link" phrasing and goes stale the same way. Standing rule `feedback_update_help_with_features` argues for updating both. One-word edit in Task 8 Step 3.

### NIT-3 — Author note 9's false-positive example is itself wrong, which proves the point about the `rating` token
Note 9 claims a future field `operating_days` "would pass" the `types.ts` `rating` tripwire — it would NOT: `"operating".includes("rating")` is true (`ope|rating`). The `rating` bare-substring check is the brittlest token in the tripwires. **Fix (optional):** assert `/\brating\b/` or the field-syntax `rating:` instead of the bare substring.

### NIT-4 — The `system-prompt.test.ts` guard doesn't actually check "Kiwi.com"
The test named "does not mention Tiqets, Kiwi.com, or Kiwitaxi" (:27–31) asserts `/tiqets/i` and `/kiwitaxi/i` only (a bare `/kiwi/i` would collide with "kiwitaxi", but `/kiwi\.com/i` would not). Task 4 Step 4 leans on this guard by its name. Optional one-line addition while Task 4 touches the area.

### NIT-5 — The production smoke seeds the brand-new metric (and prod DB) with test data
Task 11 Step 6 runs `planner-trust.spec.ts` against production (creates real `trips` rows named "Hint test", etc.) and performs real clicks that insert real `affiliate_click` rows — and real CJ/TP self-clicks (a one-off QA click is normal; just don't make it habitual per network ToS). **Fix:** note the created trip ids / `affiliate_click` rowids in the session notes so Phase 2A can start from a clean baseline (or delete the smoke rows after evidence capture).

---

## Adjudication of the 14 plan-author self-flags

| # | Flag | Verdict | Reasoning |
|---|------|---------|-----------|
| 1 | O4: Tiqets/Kiwi/Kiwitaxi ids unknown; ship disabled | **CONFIRM** (→ HIGH-2) | Repo sweep independently confirmed (only Klook ids exist). `enabled:false` + `buildUrl→""` is the correct honest handling vs blocking; the Jose handoff is adequately unmissable. Required: lift the partial-completion into the spec's success criterion, and add the optional main-session `generate_tp_links.py` id-fetch task the author itself identified. |
| 2 | Modal trigger unreachable after Task 7 | **DOWNGRADE** (accepted decision) | Verified: modal only opens on `countTripTools >= 2`, which is already impossible under the 4-tool brain — so live UX loses nothing. Keeping the machinery + comment is the correct smallest-diff reading of "remove/neutralize"; deleting the modal or firing it on flights-alone are both bigger changes with no D3 benefit. The dead UI belongs to the already-noted later dead-code pass. |
| 3 | Click-attribution design (resolves O3) | **CONFIRM design; gaps promoted** | The DOM fallbacks are real (`atlas_session_id` set at `AssistantChat.tsx:559`; `#atlas-trip-context` emits numeric `tripId` at `planner/[tripId]/page.tsx:171`+). Coverage gaps and the untested fallback became MEDIUM-1/MEDIUM-3. |
| 4 | Unauthenticated, un-rate-limited click endpoint | **CONFIRM — must-fix** (→ HIGH-1) | The reviewer disagrees with "acceptable": metric integrity is the phase deliverable and the named hardening is ~15 in-pattern lines. Plus the independent `in`-operator prototype-key validation bug in the prescribed route code. |
| 5 | `rel` asserted by token, not string order | **REFUTE** (not a problem) | Token-set assertion is the correct semantics (both orders exist in the tree — verified `noopener noreferrer sponsored` on destinations/page.tsx). Residual evasion by a novel hand-rolled rel string is inherent; "always use AffiliateLink" + the Task 10 grep is a proportionate guard. |
| 6 | TripModes: own transport sites not marked sponsored | **CONFIRM** (correct call) | First-party lead-gen cross-links are not paid third-party placements; marking them `sponsored` would be the mislabeling the spec forbids. Note: the CJ cruise link in the same component gets `rel` but no logging — folded into MEDIUM-1. |
| 7 | AtlasProse streaming snap-in | **CONFIRM** (acceptable) | Progressive same as today's links; if text streams *after* the link, promotion gracefully degrades to an inline sponsored link. No change. |
| 8 | First `.test.tsx` files in the repo | **DOWNGRADE** (non-issue) | Independently verified `vitest.config.ts` (jsdom, globals, `@vitejs/plugin-react`, tsx include, `server-only` stub alias) and installed `@testing-library/react`/`jsdom`. Ready as-is. |
| 9 | Tripwires are string-greps, not semantics | **DOWNGRADE, with a bite** | Tripwires-not-proofs is fine — but this is exactly where BLOCKER-1 lives (the plan's own comments trip them), and the note's `operating_days` example is factually wrong (NIT-3). Keep the tripwires; reword the two comments; optionally tighten `rating` to `\brating\b`. |
| 10 | `buildAutoSearchPrompt` still says "flights, hotels, and activities" | **CONFIRM** (correct to leave) | Verified at ~:500. Not a fabrication vector — the brain answers the hotel/activity parts with prose + handoff (which Task 8 upgrades to the card); changing it would alter auto-search UX out of scope. |
| 11 | E2E snapshot risk | **CONFIRM** (handled) | Verified `visual-baseline.spec.ts` covers only `/planner/[tripId]` full-page; the plausible diff source is Task 9's AirAdvisor rec removal (AffiliateRecommendations renders on that page when interests match). The review-then-update-snapshots procedure in Task 11 Step 1 covers it. |
| 12 | Line-number drift across Tasks 5–8 on AssistantChat | **CONFIRM** (handled) | Anchor-text-is-authoritative is stated in Global Constraints and re-stated; Task 7 explicitly protects Task 6's AffiliateLink in the flights panel; Task 8 greps for `renderMarkdownLite(` rather than lines. |
| 13 | Help-content updates | **CONFIRM, one miss** | Entries and the exact Task-8 phrase verified at `help-content.ts:37/39/40/44`. Missed: the "Adding items" entry (:38) has the same stale "search link" wording (NIT-2). |
| 14 | XSS posture: escape-first, no sanitizer | **CONFIRM — safe** | Verified concretely: `escapeHtml` (386–393) escapes `& < > " '` BEFORE any markup exists, so attribute breakout is impossible even though the link regex `[^)]+` admits spaces; only `https?://` and `/`-relative hrefs are linkified (blocks `javascript:`); `isAffiliateHost` sees `&amp;`-escaped query strings but hostnames are unaffected. The Task 8 promotion path is independently safe: `extractPartnerHandoff` runs on raw text but its regex forbids whitespace in URLs, host-pins to dpbolvw/tp.media, and both `label` and `url` render through React's auto-escaping in `PartnerHandoffCard`/`AffiliateLink` (never `dangerouslySetInnerHTML`). Escape-first is accepted; DOMPurify would be an out-of-spec rewrite for zero gain here. Residual (pre-existing, unchanged): `**bold**` inside a URL injects inert `<strong>` text into an href value — garbage link, not XSS. |

---

## Independent-hunt results (beyond the self-flags)

- **SSE `[TOOL:...]` contract / multi-line framing fix:** preserved. No task touches `src/lib/atlas/sse.ts`, the stream loop, or `parseMessageContent`; Task 5/8 operate strictly downstream of frame parsing. ✅
- **Spec §2 `rel` gap list — all closed?** Yes, exhaustively: the repo-wide grep for plain `rel="noopener noreferrer"` in tsx returns exactly the 9 anchors the spec lists, and each is handled by Task 5 (AssistantChat:404 → markdown-lite), Task 6 (FlightCard:46, DealCard:31, TripResultsModal:588, destinations:286/326, TripModes:57), or Task 7 deletion (HotelCard:47, TripResultsModal:700). Task 10's global grep expectation is achievable. ✅
- **Can a user click a migrated link without a log row?** Via primary click: no — all `AffiliateLink` migrations log. Via middle-click/context-menu: yes (undercount floor). Via the rel-only surfaces (TripModes cruise, destinations hotel/car, sidebar, banners, non-trailing prose links): yes by design — see MEDIUM-1 for the required transparency edit. 
- **Executor/verify split (Hermes never runs e2e):** SOUND. Verified `playwright.config.ts` has no `webServer` — e2e genuinely requires a live `:3001` server, which executors don't have. No task's correctness gate depends on e2e: each task carries objective unit/lint/build gates, full `test:unit` runs at Tasks 7/8/10 to catch cross-file regressions, and the two genuinely e2e-shaped risks (visual snapshots, live SSE→card flow) are gated at Task 11 *before* merge. Residual accepted: a runtime-only defect (e.g., hydration) surfaces first at Task 11 — which is exactly where the plan puts the evidence bar.
- **Non-objective verification gates:** none that gate a merge mechanically; the only judgment step (snapshot review, Task 11 Step 1) has an explicit review-then-update procedure with an anti-silencing clause.
- **Ordering hazards:** Task 6→7 same-file sequencing on TripResultsModal is explicitly handled ("hotel anchor … deleted wholesale in Task 7; do not touch it here" / "Keep the Flights panel (with its Task-6 AffiliateLink) intact"); Task 4's exact-set registry test is not broken by any later task; Task 9 doesn't disturb earlier system-prompt tests. The only deterministic ordering/gate failure is BLOCKER-1.
- **DB/runtime:** `affiliate_click` migration is additive and auto-applied on `getDb()`; route runs on the default Node runtime like every other `better-sqlite3` route; `/api/*` is excluded from the locale middleware so the beacon URL is correct. ✅

---

## Summary

| Severity | Count | Items |
|---|---|---|
| Blocker | 1 | Task 7 tripwire/comment self-collision (cascades to Task 7 Step 7 + Task 10 greps) |
| High | 2 | Click endpoint: `Object.hasOwn` + rate-limit/origin/enabled hardening; O4 partial-completion into success criteria + optional TP-API id fetch |
| Medium | 4 | Metric-coverage transparency + TripModes logs; `openAffiliate` unused/untested; O3 fallback test asserts nothing; `hosts` classification-vs-ownership doc |
| Nit | 5 | 215-vs-216 lines; "Adding items" help wording; `\brating\b`; kiwi.com guard assertion; prod smoke data hygiene |

The plan is unusually well-grounded — every file/line anchor checked was exact, the TDD ordering is genuinely correct (tripwires before deletion, tests before implementation), the rollback story is real, and the executor/e2e split matches the actual Playwright config. But it cannot be executed as written: BLOCKER-1 fails its own gates deterministically, and the click endpoint needs the cheap hardening + `Object.hasOwn` fix before the metric it exists to produce can be trusted.

**VERDICT: REVISE** — fix BLOCKER-1's two comments, apply HIGH-1's route fixes (hasOwn + in-pattern rate limit), and make HIGH-2's partial-completion explicit (plus the optional Task 4b id-fetch); the Mediums are small plan edits; then the plan is fit to execute.
