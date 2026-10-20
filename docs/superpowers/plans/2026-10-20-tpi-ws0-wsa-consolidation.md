# TPI WS-0 + WS-A — North-Star Rewrite & Branch Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Model Routing (CLAUDE.md) applies: Sonnet orchestrates, `glm-5.3-flash:cloud` implements, gpt-6.1-sol⇄Sonnet consensus per fix, fresh Opus verifies.

**Goal:** One clean `main` in travelplaninfo, with `NORTH_STAR.md` rewritten to "planner-first in purpose, guides-first in what gets fixed now". Every branch is merged, salvaged or deleted. The help + deploy-safety pair is fixed (10 review findings) and merged.

**Architecture:** Docs and git hygiene on `main`, plus TDD bug fixes on the `tpi-help-and-queued-content` worktree. The jarvis-project `tpi-deploy-safety` branch merges into jarvis-project `main` in the same window. Pushes and remote deletions are outward-facing: each one waits for Jose's explicit go-ahead.

**Tech Stack:** Next.js / React / TypeScript, Vitest + Testing Library (`npm run test:unit`), ESLint (`npm run lint`), git. jarvis-project: Python/pytest.

**Spec:** `docs/superpowers/specs/2026-10-20-tpi-consolidation-and-north-star-design.md` (§2, §5 WS-0, §5 WS-A, §9).

## Global Constraints
- No `git push`, `git push --delete` or deploy without Jose's explicit go-ahead in chat (CLAUDE.md, spec §7).
- The help + deploy-safety pair merges **together**, never one alone (spec §3 anti-goals).
- The schedule timer `tpi-schedule-runner.timer` stays **disabled**. Do not run slice-4 / re-enable (spec §9.1).
- No-fabrication invariant: no fabricated price, duration or link reaches the UI or `trip_items` (spec §3).
- Guards must be able to go red: an allowlist that fails closed, with a test proving a known-bad input fails (spec §7).
- Keep `data/tpi.db`. Never `rm -rf` anything under `~/.openclaw/` except the build dirs named in Task 9.
- Worktree paths: help branch `/home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo/.worktrees/tpi-help-and-queued-content`; deploy-safety `/home/jarvis/worktrees/tpi-deploy-safety`.

## Review Focus
1. **A flight with no price is added to the itinerary.** Expected: `price_estimate` is `null` and never "—". Pinned in Task 2.
2. **Flight duration of `0`, `"PT5H30M"` or `"5 hrs"`.** Expected: an unknown duration sorts last, and the Duration sort button is hidden when no flight has a real duration. Pinned in Task 3.
3. **The parent re-renders while the modal is open,** for example during streaming. Expected: focus stays on the element the user tabbed to. Pinned in Task 4.
4. **A help sentence promises hotels or activities without the word "search",** e.g. "Use Atlas to compare hotel prices". Expected: the guard fails. Pinned in Task 6.
5. **The deploy-safety merge after 54 commits of drift on main.** Expected: the full assembler test suite is green, with no lost image-naming behaviour. Pinned in Task 8.

---

### Task 1: Rewrite `docs/product/NORTH_STAR.md` (WS-0)

**Files:**
- Modify: `docs/product/NORTH_STAR.md` (main checkout)
- Modify: `/home/jarvis/.claude/projects/-home-jarvis/memory/tpi-mission.md` (add a superseded banner only)

**Interfaces:** Produces the canonical product statement that WS-B/C/D plans cite.

- [ ] **Step 1: Rewrite the one-sentence north star and the "Product thesis".**
  - Use spec §2 verbatim: "Planner-first in purpose, guides-first in what gets fixed now."
  - The layers become (1) Atlas + planner = product, (2) guides = doorway (citable fact blocks + pre-filled "Plan this trip" bridge), (3) agent distribution (MCP in ChatGPT/Claude).
  - Keep D1–D10 where they still hold. Mark D5 as amended: **301** non-English article routes to English, not canonical-only. Mark D10 as measured via GA4 click events (spec §9.2).
- [ ] **Step 2: Reconcile affiliate order.** Hotels go through CJ Hotels.com (advertiser `1702763`). Flights and Klook go through Travelpayouts (marker 164743). AirAdvisor goes through CJ (advertiser `7818110`). Tiqets/Kiwi/Kiwitaxi = WS-C. Remove the claim that D7 is "anchored in `src/config/affiliates.ts`".
- [ ] **Step 3: Add a one-line banner to the top of `tpi-mission.md`:** `> SUPERSEDED 2026-10-20 by travelplaninfo/docs/product/NORTH_STAR.md (planner-first in purpose, guides-first in fixes).`
- [ ] **Step 4: Verify.** Run `grep -n "Planner-first in purpose" docs/product/NORTH_STAR.md && grep -c "anchored in .src/config/affiliates.ts" docs/product/NORTH_STAR.md`. Expected: one match line, then `0`.
- [ ] **Step 5: Commit** `docs(north-star): planner-first in purpose, guides-first in fixes (spec 2026-10-20)`.

### Task 2: Unpriced flights persist `price_estimate: null` (review #1)

**Files:**
- Modify: `src/components/atlas/TripResultsModal.tsx:194-215`
- Test: `src/components/atlas/TripResultsModal.test.tsx`

**Interfaces:** Produces `priceEstimateFor(f: FlightResult): string | null`, exported from `src/components/atlas/TripResultsModal.tsx`. It returns `null` when `f.price === NO_PRICE_LABEL` or `f.price_value === PRICE_UNKNOWN`, and `f.price` otherwise.

- [ ] **Step 1: Write the failing tests.**
  - `it("persists price_estimate null for an unpriced ticked flight")`: render with one flight `{price: "—", price_value: PRICE_UNKNOWN}`, tick it, click Add. Assert the batch POST body's `items[0].price_estimate === null` and `JSON.stringify(body)` does not contain `"—"`.
  - `it("persists price_estimate null for the default top flight")`: same flight, nothing ticked.
- [ ] **Step 2: Run** `npx vitest run src/components/atlas/TripResultsModal.test.tsx`. Expected: both new tests FAIL (`"—"` received).
- [ ] **Step 3: Implement `priceEstimateFor`.** Use it at both `price_estimate:` sites. Replace the inline `priceForText` duplication with `priceEstimateFor(f) ?? ""`.
- [ ] **Step 4: Re-run.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(atlas): never persist "—" as price_estimate`.

### Task 3: Unknown durations stay unknown (review #2)

**Files:**
- Modify: `src/components/AssistantChat.tsx:143-147,173-178`
- Test: `src/components/AssistantChat.trip-data.test.ts`

**Interfaces:** `parseDurationMinutes(durationStr: string): number`, exported. It returns `DURATION_UNKNOWN` when nothing parses or the total is `<= 0`. It accepts `5h 30m`, `5h`, `45m`, ISO `PT5H30M`, and `5 hrs 30 mins` (case-insensitive).

- [ ] **Step 1: Write the failing tests** in `AssistantChat.trip-data.test.ts`:
  - `parseDurationMinutes("PT5H30M") === 330`
  - `parseDurationMinutes("5 hrs") === 300`
  - `parseDurationMinutes("soon") === DURATION_UNKNOWN`
  - `extractTripData` on a flight with `duration_minutes: 0` yields `duration_minutes === DURATION_UNKNOWN`
- [ ] **Step 2: Run** `npx vitest run src/components/AssistantChat.trip-data.test.ts`. Expected: 4 FAIL.
- [ ] **Step 3: Implement.**
  - Case-insensitive regexes for `h|hr|hrs|hour|hours` and `m|min|mins|minute|minutes`.
  - A positive-number guard on the producer's `duration_minutes` (mirror the `price_value` guard at line 172).
- [ ] **Step 4: Re-run.** Expected: PASS. Also run `npx vitest run src/components/atlas/TripResultsModal.test.tsx` and confirm the duration sort test still passes.
- [ ] **Step 5: Commit** `fix(atlas): unknown or zero flight duration sorts last`.

### Task 4: Stable modal close handler and focus trap (review #4)

**Files:**
- Modify: `src/components/AssistantChat.tsx:1453` (the `onClose` prop)
- Modify: `src/components/atlas/TripResultsModal.tsx` (focus-trap effect, ~l.100-133)
- Test: `src/components/atlas/TripResultsModal.test.tsx`

**Interfaces:** `TripResultsModal` props are unchanged. The modal must not depend on `onClose` identity.

- [ ] **Step 1: Write the failing test** `it("keeps focus on a tabbed-to checkbox across parent re-renders")`:
  - Render the modal open, focus the second flight checkbox.
  - `rerender` with a **new** inline `onClose` function.
  - Assert `document.activeElement` is still that checkbox.
- [ ] **Step 2: Run.** Expected: FAIL (focus moved to the Close button).
- [ ] **Step 3: Implement.**
  - In the modal, keep `onClose` in a ref (`onCloseRef.current = onClose` each render) and make the focus effect depend on `[isOpen]` only.
  - In `AssistantChat`, wrap the handler in `useCallback`.
- [ ] **Step 4: Re-run.** Expected: PASS. Also run the full modal suite.
- [ ] **Step 5: Commit** `fix(atlas): modal focus trap no longer resets on parent re-render`.

### Task 5: Inline flight cards for single searches + memoized trip extraction (review #3, #5)

**Files:**
- Modify: `src/components/AssistantChat.tsx:979-1040,1245-1305,1406`
- Test: `src/components/AssistantChat.trip-data.test.ts` (unit), plus a render test in a new file `src/components/AssistantChat.render.test.tsx`

**Interfaces:**
- Produces `useTripFlights(msgId: string, content: string): FlightResult[]`, a memoized hook in `src/components/AssistantChat.tsx` keyed by `msgId` + `content`.
- Consumes `FlightCard` (the existing inline component).

**Behavior decided:**
- When an assistant message has flight results, show the text summary and the **top 3 FlightCards inline**. The "View all & add to itinerary" button opens the modal.
- The button appears once streaming ends. The cards appear as soon as results parse.

- [ ] **Step 1: Write the failing render test** `it("shows up to 3 inline FlightCards for a single search_flights result")`. Feed a message whose content has one `search_flights` result with 5 flights. Assert 3 elements with role `article` (or FlightCard's test id) and one "View all" button.
- [ ] **Step 2: Write the failing unit test** `it("extracts trip data once per message content")`. Spy on `extractTripData` and render the same message twice with an unrelated state change. Assert the spy was called once.
- [ ] **Step 3: Run both.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Compute flights once per message via `useTripFlights`. It is used by the mobile list, the desktop list and the sidebar (line 1406).
  - Render the top 3 FlightCards under the summary in both lists.
  - Factor the two duplicated open handlers into one `openResults(flights: FlightResult[])` that bumps `modalSeq` and opens the modal.
- [ ] **Step 5: Re-run.** Expected: PASS. Then run `npm run test:unit`. Expected: all green, except the source-count tripwire, which Task 7 replaces.
- [ ] **Step 6: Commit** `fix(atlas): restore inline flight cards; extract trip data once per message`.

### Task 6: Help copy + guard that fails closed (review #8, #9)

**Files:**
- Modify: `src/lib/help-content.ts:37`
- Modify: `src/lib/help-content.guard.test.ts`

**Interfaces:** Consumes `TOOLS` and `TOOL_DOMAIN` from `src/lib/atlas/tool-loop.ts` (unchanged).

- [ ] **Step 1: Write the failing go-red test** `it("flags capability claims that avoid the word search")`. Run the guard's checker function, extracted as `findOffenders(texts: string[]): string[]` in the test file, on:
  - "Use Atlas to compare hotel prices."
  - "Atlas helps you book hotels."
  - "Search hotels and activities with Atlas."

  Assert 3 offenders.
- [ ] **Step 2: Write the failing copy test** `it("getting-started copy mentions smart search")`. Assert the itinerary "Getting started" text matches `/Start smart search/` and does not contain `does not search on its own`.
- [ ] **Step 3: Run** `npx vitest run src/lib/help-content.guard.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - **Guard:** any sentence containing `Atlas` is checked. Every noun from an expanded noun list (add `book`, `booking`, `stays`, `lodging`, `experiences`, `transfers`) must map to a live tool domain. Anything that doesn't map fails. The verb no longer matters.
  - **Copy:** replace line 37's text with: `Your itinerary opens with a placeholder row per day. Atlas searches only when you ask it in chat or tap “Start smart search” — or add items yourself.`
- [ ] **Step 5: Re-run.** Expected: PASS. All existing `HELP_CONTENT` passes the stricter guard. If it doesn't, fix the copy, never the allowlist.
- [ ] **Step 6: Commit** `fix(help): document smart search; help guard fails closed on any Atlas capability noun`.

### Task 7: Cleanups — dead range code, layering, behavioral tripwire (review #6, #7, #10)

**Files:**
- Create: `src/lib/atlas/labels.ts` (exports `NO_PRICE_LABEL`, `PRICE_UNKNOWN`, `DURATION_UNKNOWN`)
- Modify: `src/components/atlas/types.ts` (re-export from `@/lib/atlas/labels`)
- Modify: `src/lib/atlas/travelpayouts-client.ts:12-13`, `src/lib/atlas/surprise.ts:12,40` (import from `./labels`; drop the re-exports if nothing imports them, verified by grep)
- Modify: `src/components/atlas/TripResultsModal.tsx:143-160` and the range JSX (~l.467, 489)
- Modify: `src/lib/atlas/no-fabrication.test.ts:180-190`
- Test: `src/components/atlas/TripResultsModal.test.tsx`

- [ ] **Step 1: Write the behavioral test** `it("re-opening results clears the previous selection")` in `TripResultsModal.test.tsx`. Render `AssistantChat`-level open → tick a flight → close → open again via `openResults`. Assert no checkbox is checked.
- [ ] **Step 2: Run it.** Expected: PASS. This proves the invariant before the source-count assertion is deleted.
- [ ] **Step 3: Implement.**
  - Delete the `setModalSeq(` count and `key={modalSeq}` regex assertions at `no-fabrication.test.ts:186-187`, and the comment that cites them at `TripResultsModal.test.tsx:17-18`.
  - Move the labels to `src/lib/atlas/labels.ts`.
  - Replace `summary.{minTotal,maxTotal}` with a single `flightTotal: number | null` and delete the range JSX.
  - Replace `toggleSelection(setter, idx)` with a direct `toggleFlight`.
- [ ] **Step 4: Verify the layering.** Run `grep -rn "@/components" src/lib`. Expected: no output.
- [ ] **Step 5: Verify the suite.** Run `npm run test:unit && npm run lint && npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 6: Commit** `refactor(atlas): labels in lib, single flight total, behavioral modal-reset test`.

### Task 8: Merge the pair locally (no push)

**Files:**
- travelplaninfo `main` ← `tpi-help-and-queued-content`
- jarvis-project `main` ← `tpi-deploy-safety`
- Conflict: `command-post/tests/test_content_assembler.py`

- [ ] **Step 1: Post-review gate.** The Step 5 code review (`superpowers:requesting-code-review`) runs on the help branch's full diff vs `main`, and its findings are fixed. Do not proceed with open Critical/Important findings.
- [ ] **Step 2: Merge travelplaninfo.** In the main checkout, `git merge --no-ff tpi-help-and-queued-content`. Expected: no conflicts (`merge-tree` was clean on 2026-10-19). Then `npm run test:unit && npm run build`. Expected: green.
- [ ] **Step 3: Merge jarvis-project.** In `/home/jarvis/.openclaw/workspace/jarvis-project`, `git merge --no-ff tpi-deploy-safety`. Resolve `test_content_assembler.py` by keeping **both** sides' tests: main's image-naming tests and the branch's related-links / `required_internal_links` tests.
- [ ] **Step 4: Verify jarvis-project.** Run `cd command-post && python -m pytest tests/ -q`. Expected: all pass. Run `grep -c "inflight" deploy_tpi.sh`. Expected: ≥12, matching the 2026-10-19 inventory.
- [ ] **Step 5: Stop for Jose.** Report both merge SHAs and the test output. Pushing both repos and running `jarvis-project/scratchpad/rollout_2026-09-12_tpi_deploy_safety.sh prepare|push|verify` happens only on Jose's go-ahead. The prod parts go as a `.sh` Jose runs with `! bash <path>`. The timer stays disabled.

### Task 9: Salvage, prune, clean

**Files:**
- From `docs/2026-07-07-banked-plans`, the 12 `docs/superpowers/{specs,plans,reviews}/2026-07-07-*` files (factory-mcp, phase2a-gsc-analytics, phase3-monetization-loop, tailwind-4-upgrade)
- From `origin/brand/favicons-2026-08-26`: `public/apple-touch-icon.png`, `public/favicon.ico`, `public/icon.png`, `public/brand/tpi-logo.svg`, `public/brand/tpi-mark.svg`

- [ ] **Step 1: Salvage the docs.** `git checkout docs/2026-07-07-banked-plans -- docs/superpowers/` (that path only, not `.gitignore`). Commit `docs: salvage 2026-07-07 banked specs/plans (phase2a, phase3, factory-mcp, tailwind4)`. Verify with `git ls-files docs/superpowers | grep -c 2026-07-07`. Expected: `12`.
- [ ] **Step 2: Salvage the assets.** Check out the 5 asset paths above from the favicons branch, leaving `public/favicon.svg` as main's version. Add `icons: { icon: [{url:"/favicon.ico"},{url:"/icon.png",type:"image/png"},{url:"/favicon.svg",type:"image/svg+xml"}], apple: "/apple-touch-icon.png" }` to the root `metadata` export in `src/app/layout.tsx`. Verify with `npm run build`, then open `/` locally on :3210 and confirm the `<link rel="icon">` tags are present (`curl -s localhost:3210 | grep -c 'rel="icon"'` ≥ 2). Commit.
- [ ] **Step 3: Prepare the deletion list.** Write `scratchpad/branch-prune-2026-10-20.sh` with `list` (default, prints only) and `apply` modes covering:
  - **Local:** `feature/three-mode-entry-system`, `docs/2026-07-07-banked-plans`, `backup/pre-evergreen-slugs-2026-09-01`, `docs/apache-runbook-correction`, `feat/ga4-analytics`, `fix/guest-onboarding-atlas-wiring`, and `tpi-help-and-queued-content` (after Task 8 merge, via `git worktree remove` first).
  - **Remote:** `brand/favicons-2026-08-26`, `tpi-design-gemini`, `docs/apache-runbook-correction`, `docs/tpi-atlas-product-package`, `feat/ga4-analytics`, `feature/atlas-brain-relocation`, `feature/atlas-health-gate`, `fix/atlas-review-findings`, `fix/guest-onboarding-atlas-wiring`, and `tpi-help-and-queued-content` (after the pair is pushed).
  - `apply` uses `git branch -D` for squash-merged/salvaged branches and `git branch -d` for the rest, plus `git push origin --delete`.
- [ ] **Step 4: Stop for Jose.** Show the `list` output. `apply` runs only on Jose's explicit approval of that list (spec §8).
- [ ] **Step 5: Clean build output.** In the main checkout, remove `.next/ playwright-report/ test-results/ .ruff_cache/`. Verify with `ls data/tpi.db`. Expected: the file is still present.
- [ ] **Step 6: Final check.** `git status` is clean. `git branch -a --no-merged main` lists only branches Jose chose to keep.
