# TPI WS-0 + WS-A — North-Star Rewrite & Branch Consolidation Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Model Routing (CLAUDE.md) applies: Sonnet orchestrates, `glm-5.3-flash:cloud` implements, gpt-6.1-sol⇄Sonnet consensus per fix, fresh Opus verifies.

**Rev 2 (2026-10-20):** this revision applies the Opus plan review, which returned REVISE: C1–C3, I1–I9 and the minor items.

**Goal:**
- One clean `main` in travelplaninfo.
- `NORTH_STAR.md` rewritten to "planner-first in purpose, guides-first in what gets fixed now".
- The help + deploy-safety pair fixed (10 review findings) and merged locally.
- Every other branch salvaged or archived, then pruned once Jose approves.

**Architecture:**
- TDD fixes on the `tpi-help-and-queued-content` worktree.
- Both repos merge in **detached temporary worktrees**, are tested there, then fast-forward each `main` only if both are green.
- A new dated rollout script carries the queue migration. Jose runs it.
- Every push, remote deletion and prod step waits for Jose.

**Tech Stack:** Next.js / React / TypeScript, Vitest + Testing Library (`npm run test:unit`), ESLint, `tsc`. jarvis-project uses Python and pytest via `/home/jarvis/.venvs/command-post-api/bin/python -m pytest`.

**Spec:** `docs/superpowers/specs/2026-10-20-tpi-consolidation-and-north-star-design.md` (§2, §5 WS-0, §5 WS-A, §9).

## Global Constraints
- No `git push`, `git push --delete`, deploy or prod command without Jose's explicit go-ahead in chat. Prod work ships as a `.sh` file Jose runs with `! bash <path>`.
- The help + deploy-safety pair lands **together**. Neither `main` moves unless both merged trees are green (Task 8).
- **No `deploy_tpi.sh` run** between the jarvis-project fast-forward and the completion of the rollout migration (Task 9). The schedule timer stays **disabled**.
- No-fabrication invariant: no "—", made-up price, duration or link reaches the UI or `trip_items`.
- Guards fail closed, and each new guard gets a test proving a known-bad input goes red.
- Shared checkouts: commit by explicit path only. jarvis-project `main` has ~235 uncommitted entries from other sessions; never `git add -A` there.
- Keep `data/tpi.db`. Delete nothing unmerged without an archived ref (Task 10).
- Worktrees: help branch `/home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo/.worktrees/tpi-help-and-queued-content`; deploy-safety `/home/jarvis/worktrees/tpi-deploy-safety`.
- Baseline before Task 2 (the reviewer's run): help worktree 42 test files / 402 tests pass, lint 0 errors, `tsc` clean.

## Review Focus
1. **Unpriced flight added to the itinerary.** `price_estimate` is `null` on the client **and** after the batch route. Task 2.
2. **Durations `0` / NaN / `"PT5H30M"` / `"5 hrs"` / all-unknown.** Unknown sorts last, and there is no Duration sort button when none are known. Task 3.
3. **Parent re-renders while the modal is open.** Focus stays put, and close returns focus to the real opener. Task 4.
4. **A new or edited help sentence about Atlas that isn't on the approved list.** The guard fails. Task 7.
5. **The deploy-safety merge after 54 commits of drift.** The failing-test set equals main's baseline set exactly, with the 18 merge-induced failures fixed. Task 8.

---

### Task 1: Rewrite `docs/product/NORTH_STAR.md` (WS-0)

**Files:**
- Modify: `travelplaninfo/docs/product/NORTH_STAR.md`, including the "One-sentence north star" and "Product thesis" sections and lines ~100 and ~114. Line 114 cites `docs/DECISIONS.md`; reconcile that citation too.
- Modify: `/home/jarvis/.claude/projects/-home-jarvis/memory/tpi-mission.md` (banner only)
- Modify: `/home/jarvis/.claude/projects/-home-jarvis/memory/MEMORY.md` (the "TPI — Product Design" line: point Mission to NORTH_STAR)

- [ ] **Step 1: Rewrite the thesis.**
  - Use spec §2 verbatim: "Planner-first in purpose, guides-first in what gets fixed now."
  - Three layers: (1) Atlas + planner = product; (2) guides = doorway (citable fact blocks + pre-filled "Plan this trip" bridge); (3) agent distribution (MCP in ChatGPT/Claude).
  - Keep D1–D10 where they still hold. **D5 amended:** non-English *article* routes 301 to English. **D10:** measured via GA4 click events.
- [ ] **Step 2: Reconcile the affiliate order.**
  - Hotels: CJ Hotels.com, advertiser `1702763`, evergreen link `15734399` (verified active 2026-10-20).
  - Flights + Klook: Travelpayouts, marker `164743`.
  - AirAdvisor: CJ advertiser `7818110`, link `17238636`.
  - Tiqets / Kiwi / Kiwitaxi: WS-C.
  - Remove "anchored in `src/config/affiliates.ts`".
- [ ] **Step 3: Add the banner** to the top of `tpi-mission.md`: `> SUPERSEDED 2026-10-20 by travelplaninfo/docs/product/NORTH_STAR.md (planner-first in purpose, guides-first in fixes).` Then update the MEMORY.md pointer.
- [ ] **Step 4: Verify.** `grep -n "Planner-first in purpose" docs/product/NORTH_STAR.md`, then `grep -c "anchored in .src/config/affiliates.ts" docs/product/NORTH_STAR.md`. Expected: one line, then `0`.
- [ ] **Step 5: Commit by explicit path.**
  - travelplaninfo: `git commit docs/product/NORTH_STAR.md -m "docs(north-star): planner-first in purpose, guides-first in fixes"`.
  - Home repo: `git commit .claude/projects/-home-jarvis/memory/tpi-mission.md .claude/projects/-home-jarvis/memory/MEMORY.md -m "memory: tpi-mission superseded by NORTH_STAR"`.

### Task 2: Unpriced flights persist `price_estimate: null` (review #1)

**Files:**
- Modify: `src/components/atlas/TripResultsModal.tsx:183` (`BatchItem.price_estimate: string | null`) and `:194-215`
- Modify: the trip-items batch route under `src/app/api/` that receives `BatchItem[]` (find it with `grep -rln "BatchItem\|items.*price_estimate" src/app/api`). Type the field as `string | null`, and make the route normalize `NO_PRICE_LABEL` to `null`.
- Test: `src/components/atlas/TripResultsModal.test.tsx`, plus the batch route's test file. Create `<route-dir>/route.test.ts` if none exists.
- Create: `travelplaninfo/scratchpad/count_dash_price_rows_2026-10-20.sh`. It is read-only and prints `SELECT count(*) FROM trip_items WHERE price_estimate='—'` against prod (the DB path and command are taken from `deploy_tpi.sh`'s ssh conventions).

**Interfaces:** Produces `priceEstimateFor(f: FlightResult): string | null`, exported from `TripResultsModal.tsx`. It returns `null` when `f.price === NO_PRICE_LABEL` or `f.price_value === PRICE_UNKNOWN`, and `f.price` otherwise.

- [ ] **Step 1: Write the failing modal tests.**
  - `it("persists price_estimate null for an unpriced ticked flight")`: flight `{price:"—", price_value: PRICE_UNKNOWN}`; tick it; Add. Assert `body.items[0].price_estimate === null` and that `JSON.stringify(body)` has no `"—"`.
  - `it("persists price_estimate null for the default top flight")`: the same, with nothing ticked.
- [ ] **Step 2: Write the failing route test.**
  - `it("normalizes a '—' price_estimate to null")`: POST one item with `price_estimate:"—"`.
  - Assert that the value handed to the DB layer (mock it) is `null`.
- [ ] **Step 3: Run** `npx vitest run src/components/atlas/TripResultsModal.test.tsx <route test>`. Expected: 3 FAIL.
- [ ] **Step 4: Implement.**
  - Add `priceEstimateFor` and use it at both sites; `description` uses `priceEstimateFor(f) ?? ""`.
  - Change the types.
  - Normalize in the route.
- [ ] **Step 5: Re-run.** Expected: PASS. Then run `npx tsc --noEmit`, expecting clean.
- [ ] **Step 6: Write the count script** (read-only; header comment says so). Do not run it; it goes to Jose in Task 8's report.
- [ ] **Step 7: Commit:** `fix(atlas): never persist "—" as price_estimate (client + batch route)`.

### Task 3: Unknown durations stay unknown (review #2)

**Files:**
- Create: `src/components/atlas/trip-data.ts`. Move `parseDurationMinutes`, `parsePriceValue` and `extractTripData` here from `AssistantChat.tsx:~130-190`; `AssistantChat` imports them. This module also gives Task 6 a spy-able boundary.
- Modify: `src/components/AssistantChat.tsx` (imports only)
- Test: `src/components/AssistantChat.trip-data.test.ts` (update its import path), `src/components/atlas/TripResultsModal.test.tsx`

**Interfaces:**
- Produces `parseDurationMinutes(s: string): number`. It returns `DURATION_UNKNOWN` when nothing parses or the total is `<= 0`.
- It accepts `5h 30m`, `5h`, `45m`, `PT5H30M` and `5 hrs 30 mins`, case-insensitive.
- `extractTripData(parts: ToolResult[]): { flights: FlightResult[] }` is unchanged.

- [ ] **Step 1: Write the failing unit tests.**
  - `parseDurationMinutes("PT5H30M") === 330`
  - `("5 hrs") === 300`
  - `("soon") === DURATION_UNKNOWN`
  - `extractTripData` with `duration_minutes: 0` gives `DURATION_UNKNOWN`
  - `extractTripData` with `duration_minutes: NaN` gives `DURATION_UNKNOWN`
- [ ] **Step 2: Write the failing modal tests.**
  - `it("hides Sort by Duration when no flight has a known duration")`
  - `it("sorts unknown-duration flights last under Sort by Duration")`: 3 flights with durations 300, unknown and 120. Clicking Duration orders them 120, 300, unknown.
- [ ] **Step 3: Run both files.** Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
  - Do the module move.
  - Use case-insensitive regexes for `h|hr|hrs|hour|hours` and `m|min|mins|minute|minutes`.
  - Guard the producer value with `Number.isFinite(x) && x > 0 ? x : DURATION_UNKNOWN`.
- [ ] **Step 5: Re-run, plus `npm run test:unit`.** Expected: all green.
- [ ] **Step 6: Commit:** `fix(atlas): unknown/zero/NaN flight duration sorts last; trip-data module`.

### Task 4: Stable modal close handler and focus trap (review #4)

**Files:**
- Modify: `src/components/atlas/TripResultsModal.tsx`, the focus-trap effect (~l.85-133; focus moves to Close in a `requestAnimationFrame` at ~l.94)
- Modify: `src/components/AssistantChat.tsx:~1453` (`onClose` → `useCallback`)
- Test: `src/components/atlas/TripResultsModal.test.tsx`

**Interfaces:** `TripResultsModal` props are unchanged. The effect must not depend on `onClose` identity.

- [ ] **Step 1: Write the failing test** `it("keeps focus across parent re-renders and returns it to the opener on close")`.
  1. Render an opener `<button>`, focus it, then render the modal open.
  2. **Flush pending animation frames.** Use fake timers with `vi.advanceTimersToNextFrame()`, or stub `requestAnimationFrame` to run synchronously.
  3. Focus the 2nd flight checkbox.
  4. `rerender` with a **new** inline `onClose`, then flush frames.
  5. Assert that the checkbox is still `document.activeElement`.
  6. Close, flush, and assert the opener button is `document.activeElement`.
- [ ] **Step 2: Run.** Expected: FAIL. Focus jumps to Close, and the opener is overwritten.
- [ ] **Step 3: Implement.**
  - Keep `onCloseRef.current = onClose` updated every render.
  - The effect depends on `[isOpen]` only.
  - Capture `openerRef` only when `isOpen` goes false→true.
  - In `AssistantChat`, `const closeModal = useCallback(() => setModalOpen(false), [])`.
- [ ] **Step 4: Re-run the modal suite.** Expected: PASS.
- [ ] **Step 5: Commit:** `fix(atlas): modal focus trap survives parent re-renders`.

### Task 5: Labels in lib, dead range code, behavioral reset test (review #6, #7, #10)

Task 5 runs **before** Task 6, so the source-count tripwire is replaced before Task 6 removes a `setModalSeq(` call site.

**Files:**
- Create: `src/lib/atlas/labels.ts`. It exports `NO_PRICE_LABEL`, `PRICE_UNKNOWN` and `DURATION_UNKNOWN`, with values copied from `src/components/atlas/types.ts:28-34`.
- Modify: `src/components/atlas/types.ts` (re-export from `@/lib/atlas/labels`), `src/lib/atlas/travelpayouts-client.ts:12-13` and `src/lib/atlas/surprise.ts:12` (import from `./labels`). **Keep** the `surprise.ts:40` re-export, because `src/app/api/surprise-me/route.ts` imports it through a multi-line import.
- Modify: `src/components/atlas/TripResultsModal.tsx`. `summary` becomes `{ flightTotal: number | null }`; delete the range JSX (~l.467, ~l.489); `toggleSelection` becomes a direct `toggleFlight`.
- Modify: `src/lib/atlas/no-fabrication.test.ts:180-190` and the comment at `TripResultsModal.test.tsx:17-18`
- Test: `src/components/atlas/TripResultsModal.test.tsx`

- [ ] **Step 1: Write the behavioral test** `it("a new modal instance starts with no selection")`.
  - Render `<TripResultsModal key={1} …/>`, tick a flight.
  - Re-render with `key={2}` (what a `modalSeq` bump produces).
  - Assert that no checkbox is checked.
- [ ] **Step 2: Mutation check.** Temporarily render with the same `key` on both renders and confirm the test goes **red**, then restore. Record both outputs in the commit body.
- [ ] **Step 3: Implement.**
  - Delete the `setModalSeq(` count assertion and the `key={modalSeq}` regex at `no-fabrication.test.ts:186-187`.
  - Keep one assertion that `AssistantChat` passes `key={modalSeq}` to the modal. This is a prop wiring check; Task 6 owns the bump.
  - Make the label move and the dead-code removal.
- [ ] **Step 4: Verify.** `grep -rn "@/components" src/lib` gives no output. `npm run test:unit && npm run lint && npx tsc --noEmit` all pass (lint: 0 errors).
- [ ] **Step 5: Commit:** `refactor(atlas): labels in lib, single flight total, behavioral modal-reset test`.

### Task 6: Inline flight cards back + extract trip data once per message (review #3, #5)

**Decided behavior (my call, flagged to Jose in Task 8's report):**
- Restore `main`'s behavior: an assistant message with flight results shows the text summary and **all** its FlightCards inline.
- Once streaming ends, it also shows the branch's "Add to itinerary" button, which opens the modal.
- This is additive: nothing the user saw on `main` disappears.

**Files:**
- Create: `src/components/atlas/AssistantMessageBody.tsx`, a `React.memo` presentational component. The message's tool-result rendering currently in the two duplicated JSX blocks (`AssistantChat.tsx:~976-1040` mobile and `~1242-1305` desktop) moves here.
- Modify: `src/components/AssistantChat.tsx`. Both lists render `<AssistantMessageBody>`. One `openResults(flights: FlightResult[])` replaces the two open handlers: it calls `setModalSeq(n => n + 1)`, sets the modal flights and opens the modal. The sidebar (~l.1406) reads the same memoized data.
- Modify: `src/components/atlas/FlightCard.tsx` (or wherever `FlightCard` lives): add `data-testid="flight-card"`.
- Test: create `src/components/atlas/AssistantMessageBody.test.tsx`.

**Interfaces:**
- `AssistantMessageBody` props:

  ```ts
  { content: string; isStreaming: boolean; onOpenResults: (flights: FlightResult[]) => void }
  ```

- Inside, `const flights = useMemo(() => extractTripData(parseToolResults(content)).flights, [content])`. The existing parse helper is named whatever `AssistantChat` uses today; move it alongside.
- It consumes `extractTripData` from `src/components/atlas/trip-data.ts` (Task 3).

- [ ] **Step 1: Write the failing tests.**
  - `it("renders every FlightCard inline for a single search_flights result")`: content with one result of 5 flights. Expect 5 `flight-card`s.
  - `it("shows Add to itinerary only after streaming")`: with `isStreaming` true, no button; false, button present. Clicking it calls `onOpenResults` with 5 flights.
  - `it("extracts trip data once per content")`: `vi.mock("./trip-data", async (orig) => ({ ...(await orig()), extractTripData: vi.fn((await orig()).extractTripData) }))`. Re-render the same `content` with a changed unrelated parent state. Expect 1 call.
- [ ] **Step 2: Run.** Expected: FAIL (the component doesn't exist).
- [ ] **Step 3: Implement** the component and wire both lists and the sidebar to it.
- [ ] **Step 4: Verify.** `npm run test:unit && npm run lint && npx tsc --noEmit`. Expected: all pass, lint 0 errors, including `react-hooks/rules-of-hooks`.
- [ ] **Step 5: Commit:** `fix(atlas): inline flight cards restored; trip data extracted once per message`.

### Task 7: Help copy + approved-sentence guard (review #8, #9)

**Files:**
- Modify: `src/lib/help-content.ts:37`
- Modify: `src/lib/help-content.guard.test.ts`
- Create: `src/lib/help-content.atlas-approved.json`. It is an array of `{ "sha256": string, "text": string }`, one entry per approved sentence containing "Atlas".

**Rule:**
- Every sentence in `HELP_CONTENT` (intro + section text, split on `.!?;`) that contains `Atlas` must have its sha256 in the approved file.
- Any new or edited Atlas sentence fails until a human adds it.
- The existing tool-domain check stays as a second layer.

- [ ] **Step 1: Write the failing tests.**
  - `it("every Atlas sentence is on the approved list")`. This passes on today's copy once the file is generated, so first also write the next test.
  - `it("an unapproved Atlas sentence fails")`: run the exported checker `findUnapproved(texts: string[], approved: Set<string>): string[]` on `["Use Atlas to compare hotel prices.", "Atlas helps you book hotels.", "Search hotels and activities with Atlas."]` with today's approved set. Assert **3** offenders, counted per sentence.
  - `it("getting-started copy names smart search")`: the itinerary "Getting started" text includes the value of `atlasSmartSearch.start` read from `messages/en/common.json`, and does not include `does not search on its own`.
- [ ] **Step 2: Run.** Expected: the 2nd and 3rd tests FAIL.
- [ ] **Step 3: Implement.**
  - Replace line 37's text with: `Your itinerary opens with a placeholder row per day. Atlas searches only when you ask it in chat or tap “<atlasSmartSearch.start>” — or add items yourself.` The quoted label is the literal current English value of `atlasSmartSearch.start`.
  - Generate the approved file from the **current** copy, with a script in the test file's comment.
  - Review each sentence: every one must be true under D3. Prose suggestions are OK; search claims are only OK for live tools.
- [ ] **Step 4: Re-run, plus the full suite.** Expected: PASS.
- [ ] **Step 5: Commit:** `fix(help): document smart search; Atlas help sentences require approval (hash-pinned)`.

### Task 8: Post-review, then merge both repos in temporary worktrees (local only)

**Files:**
- `command-post/tests/test_content_assembler.py`, at the conflict (merged ~l.539-545) and the branch-added tests (~l.451, ~l.483)
- `command-post/tests/test_seo_image_consumers.py:226`

- [ ] **Step 1: Post-review gate.**
  - Run `superpowers:requesting-code-review` on `main...tpi-help-and-queued-content` (fresh Opus).
  - Fix its Critical and Important findings with the same task style.
  - Re-run `npm run test:unit && npm run lint && npx tsc --noEmit && npm run build` in the help worktree. Expected: green.
- [ ] **Step 2: jarvis-project baseline.**
  - `git worktree add --detach /home/jarvis/scratch/merge-jp-2026-10-20 main`, then run pytest there.
  - Save the sorted list of failing test ids to `/home/jarvis/scratch/merge-jp-2026-10-20.baseline.txt`. Expected: ~16 environment failures (the reviewer saw orchestrator_router, slug_guard, sprints_registry …).
- [ ] **Step 3: jarvis-project merge in the temp worktree.**
  - `git merge --no-ff tpi-deploy-safety`.
  - Resolve the one conflict hunk by taking **main's** `find_hero_image` patch `lambda s, *a, **k: None` and **the branch's** `_get_internal_links` patch `lambda *a, **k: []`.
  - Change the two branch tests' `find_hero_image` patches (~l.451, ~l.483) to `lambda s, *a, **k: None`, and `test_seo_image_consumers.py:226` to `lambda *a, **k: []`.
- [ ] **Step 4: jarvis-project verify.** Run pytest, then diff the sorted failing ids against the baseline. Expected: **identical sets**. `git diff tpi-deploy-safety HEAD -- command-post/deploy_tpi.sh` must be empty.
- [ ] **Step 5: travelplaninfo merge in a temp worktree.**
  - `git worktree add --detach /home/jarvis/scratch/merge-tpi-2026-10-20 main`, then `git merge --no-ff tpi-help-and-queued-content`. Expected: no conflicts.
  - Run `npm ci && npm run test:unit && npx tsc --noEmit && npm run build`. Expected: green.
- [ ] **Step 6: Fast-forward both mains, only if Steps 4 and 5 are both green.**
  - For each repo, list the paths the merge commit changes vs `main`, and the dirty paths in the main checkout (`git status --porcelain`). Their intersection must be empty, except `next-env.d.ts` in travelplaninfo: `git checkout -- next-env.d.ts` first.
  - Then `git -C <main checkout> merge --ff-only <temp worktree HEAD sha>` for both.
  - Remove the temp worktrees.
- [ ] **Step 7: Report to Jose and stop.** Include:
  - both merge SHAs and the test evidence;
  - the Task 6 behavior call;
  - the `count_dash_price_rows` script path;
  - the out-of-scope finding: the quick-action chips "Find hotels", "Find restaurants" and "Search activities" (`AssistantChat.tsx:66-73`) invite searches Atlas can't run;
  - a reminder: **no `deploy_tpi.sh` until Task 9's script has run.**

### Task 9: New rollout script for the migration (Jose runs)

**Files:**
- Create: `jarvis-project/scratchpad/rollout_2026-10-20_tpi_deploy_safety.sh`, derived from `rollout_2026-09-12_tpi_deploy_safety.sh`.

- [ ] **Step 1: Write the script** with modes `prepare | push | verify`.
  - Drop the old steps 1–2: the merges already happened in Task 8. Its preconditions instead assert that both mains contain the merge commits: `git merge-base --is-ancestor <sha> main`.
  - Keep step 0's inflight check, and steps 3–7 (queued migration, required links, go-live dates, link gate, explicit-path commit), driven by the live queue.
  - Header comment states:
    - kihei and fort-lauderdale are `cancelled` in `state/tpi-schedule-queue.json`, so step 3 moves nothing off the site;
    - step 4 **edits those two live articles** to add required links;
    - no deploy may run between the jarvis-project fast-forward and `push`.
  - Use `/home/jarvis/.venvs/command-post-api/bin/python` everywhere instead of `python3`.
- [ ] **Step 2: Dry-validate.** Run `bash -n` and `shellcheck` (if installed) on the script. Run `prepare`'s precondition block alone in a guarded `--check` mode that prints and exits without writing. Expected: the preconditions pass.
- [ ] **Step 3: Review.** A fresh Opus reviewer reads the script against the 09-12 original. Fix its findings.
- [ ] **Step 4: Stop for Jose.** Hand over `! bash <path> prepare`, then `push`, then `verify`. The timer stays disabled.

### Task 10: Salvage + archive

- [ ] **Step 1: Salvage the docs.** Run `git checkout docs/2026-07-07-banked-plans -- <12 paths>` with these exact paths:
  - `docs/superpowers/plans/2026-07-07-{factory-mcp,phase2a-gsc-analytics,phase3-monetization-loop,tailwind-4-upgrade}.md`
  - `docs/superpowers/reviews/2026-07-07-{factory-mcp,phase2a-gsc-analytics,phase3-monetization-loop,tailwind-4-upgrade}-plan-review.md`
  - `docs/superpowers/specs/2026-07-07-{factory-mcp,phase2a-gsc-analytics,phase3-monetization-loop,tailwind-4-upgrade}-design.md`

  Verify with `git ls-files docs/superpowers | grep -c 2026-07-07`, expecting `12`. Commit by explicit path.
- [ ] **Step 2: Archive every unmerged ref before any deletion.**
  - `git fetch --prune origin`.
  - Create `git tag archive/2026-10-20/<name> <sha>` for `feature/three-mode-entry-system`, `docs/2026-07-07-banked-plans`, `origin/brand/favicons-2026-08-26` and `origin/tpi-design-gemini`.
  - `git bundle create /home/jarvis/backups/tpi-branches-2026-10-20.bundle --all`, then `git bundle verify` it. Expected: "is okay".
- [ ] **Step 3: Favicon comparison (Jose's visual call; no wiring).**
  - Render main's `public/favicon.svg` and the branch's `public/brand/tpi-mark.svg`, `icon.png` and `apple-touch-icon.png` side by side into `scratchpad/favicon-compare-2026-10-20.html`.
  - Open it with `code`.
  - Wiring into `src/app/[locale]/layout.tsx:28-38` (the real `metadata.icons`) becomes a follow-up only if Jose picks the branch set.

### Task 11: Prune list + clean build output

- [ ] **Step 1: Write the prune script** `travelplaninfo/scratchpad/branch-prune-2026-10-20.sh`. It has modes `list` (default) and `apply`, and pins each ref's SHA at `list` time. `apply` refuses if any SHA moved or if the `archive/2026-10-20/*` tags or the bundle are missing.
  - **Local:** `feature/three-mode-entry-system`, `docs/2026-07-07-banked-plans`, `backup/pre-evergreen-slugs-2026-09-01`, `docs/apache-runbook-correction`, `feat/ga4-analytics`, `fix/guest-onboarding-atlas-wiring`, and `tpi-help-and-queued-content` (`git worktree remove` first, only after Task 9 `push`).
  - **Remote:** `brand/favicons-2026-08-26`, `tpi-design-gemini`, plus the **7** fully-merged branches: `docs/apache-runbook-correction`, `docs/tpi-atlas-product-package`, `feat/ga4-analytics`, `feature/atlas-brain-relocation`, `feature/atlas-health-gate`, `fix/atlas-review-findings`, `fix/guest-onboarding-atlas-wiring`. Add `tpi-help-and-queued-content` after it is pushed.
  - jarvis-project `tpi-deploy-safety` local + remote, after Task 9 `push`.
- [ ] **Step 2: Clean build output.** In the travelplaninfo main checkout, `rm -rf .next playwright-report test-results .ruff_cache`. Verify with `ls data/tpi.db`; it must still be present.
- [ ] **Step 3: Stop for Jose.** Show the `list` output with each archive tag. `apply` runs only on his approval.
