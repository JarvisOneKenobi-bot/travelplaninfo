# Adversarial Plan Review — TPI Tailwind 3→4 Upgrade (Loop #2)

**Date:** 2026-07-07
**Reviewer:** Fable 5 (independent adversarial review, Step 2 of the dev pipeline — did not author the spec or plan)
**Spec:** `docs/superpowers/specs/2026-07-07-tailwind-4-upgrade-design.md`
**Plan:** `docs/superpowers/plans/2026-07-07-tailwind-4-upgrade.md` (incl. its 10 plan-author notes)
**Repo:** `travelplaninfo-prototype` @ `4d5a1e7`

**Method:** every load-bearing claim was spot-checked against (a) the repo at `4d5a1e7`, (b) the *installed* tailwindcss 3.4.19 (`node_modules/.../preflight.css`), (c) a real Tailwind **4.3.1** install on this machine (`~/.hermes/hermes-agent/node_modules/tailwindcss/` — `theme.css`, `preflight.css`, `dist/lib.js`), (d) the **live production CSS of travelplaninfo.com fetched today**, and (e) the official v4 upgrade guide (context7). No claims below rest on training-data memory alone.

---

## VERDICT: **REVISE**

1 Blocker + 4 High. All fixes are localized text edits to the plan (plus a one-paragraph spec correction) — no architectural rework. The loop skeleton (sequencing, gates, artifacts, rollback, hook-compliance) is sound and unusually well-instrumented; but the Blocker is a verification gate that **false-fails into an automated production rollback**, which must not survive into execution.

**Findings: 1 Blocker · 4 High · 5 Medium · 1 Low · 2 Nit (13 total)**

---

## Blocker

### B-1 — Task 13 Step 2's live v4-CSS assertion can never pass, and its failure path executes a production rollback

**Location:** Plan Task 13 Step 2 (lines ~989–1000).

**Defect (two independent legs, both verified against live prod today):**
1. **Wrong CSS path.** The live homepage's stylesheet is `/_next/static/chunks/019rtskkm_ky7.css` — Next 16 (Turbopack) emits CSS under `static/chunks/`, not `static/css/`. The plan's `grep -oE '/_next/static/css/[^"]+\.css'` matches **nothing** → `CSSPATH` is empty → `curl "https://travelplaninfo.com$CSSPATH"` silently re-fetches the homepage HTML.
2. **The banner does not survive minification.** The live v3 stylesheet contains **zero** occurrences of `tailwindcss v` (verified: `grep -c 'tailwindcss v'` = 0 on the fetched chunk) — the production minifier strips `/*! ... */` comments. The expected `/*! tailwindcss v4.x.x ...*/` banner will therefore never appear in a healthy v4 deploy either.

The plan's instruction — "If the banner still says v3 or the file 404s … go to Task 15" — means an unattended Hermes, following the plan exactly, **rolls back a perfectly healthy deploy** (or must improvise, which the plan rightly forbids elsewhere).

**Fix (concrete):**
```bash
CSSPATH=$(curl -s https://travelplaninfo.com/ | grep -oE '/_next/static/(chunks|css)/[^"]+\.css' | head -1)
[ -n "$CSSPATH" ] || { echo "NO stylesheet link found — STOP, inspect HTML"; }
curl -s "https://travelplaninfo.com$CSSPATH" -o "$ART/live.css"
grep -c '@layer'  "$ART/live.css"   # v4 ≥ 1 — v3 emits none (verified 0 on live today)
grep -c 'oklch('  "$ART/live.css"   # v4 ≥ 1 — v3 emits none (verified 0 on live today)
grep -c 'webkit-backdrop-filter' "$ART/live.css"  # ≥ 1 (O1 holding in prod)
```
`@layer` / `oklch(` / `@property` are minification-proof v4 discriminators (all three measure **0** in today's live v3 CSS). Keep the rollback trigger, pointed at the corrected assertions.

---

## High

### H-1 — `.next/static/css/*.css` does not exist under Next 16 Turbopack builds → Task 1 Step 5 and Task 5 Step 4 (O1) break at baseline time

**Location:** Plan Task 1 Step 5; Task 5 Step 4.

**Defect:** same root cause as B-1, local edition. `cat .next/static/css/*.css` will fail (`No such file or directory`) because the build emits CSS under `.next/static/chunks/` — proven by the production artifact this very pipeline produced (`npx next build` on the VPS → chunk-path CSS on live). The pre-flight baseline (`baseline-prefixes.txt`) is the anchor for the entire O1 verification; Task 1 dies on its fifth step.

**Fix:** in both tasks replace the glob with a layout-agnostic form:
```bash
find .next/static -name '*.css' -exec cat {} + | grep -oE '\-(webkit|moz|ms|o)-[a-z-]+' | sort -u
```
(The two hard gates are sound: today's live v3 CSS contains `-webkit-backdrop-filter` and exactly one `-webkit-line-clamp` — verified.)

### H-2 — Border-compat strategy has two holes: the manual fallback omits it entirely, and the conditional trigger (the eyeball) cannot see most of the exposed pages

**Location:** Plan Task 2 Step 5 (manual fallback); Task 4 Step 2; Task 9 Step 6 + Step 6-FIX.

**Adjudication of the compat approach itself (per review brief):** the `@layer base { … border-color: var(--color-gray-200, currentColor) }` fix is **correct and is not masking a real regression** — it is byte-for-byte the official upgrade-guide snippet and restores exactly v3's default; explicit `border-<color>` utilities still win (utilities layer > base layer). Fixing "properly" (explicit colors at all 213 call sites) is a follow-up cleanup loop, not a zero-visual-regression upgrade. The strategy is right; the **wiring** is defective:

1. **Manual fallback omission.** If the codemod cannot run, Task 2 Step 5(a)–(e) reproduces everything *except* the preflight-compat CSS the codemod would have inserted. On that path, raw v4 `currentColor` borders ship.
2. **Conditional trigger vs. coverage.** Step 6-FIX applies "only if item 1 shows border drift" — but the visual gates cover `/planner` (3 widths) + one article page only. Measured exposure: **26 border-carrying elements with no color utility on the element** (regex sweep, minus 1 false positive in a `MapDrawer.tsx` JS string), including home/destinations-only components the gates never render: `TrendingDestinations.tsx:56`, `DestinationSuggestions.tsx:109`, `SurpriseMeQuiz.tsx:96,306`, `PackageDealsCarousel.tsx:116`, `OnboardingModal.tsx:213`, plus `atlas/TripResultsModal.tsx` (×4). Border drift on those pages sails past every gate to prod.

**Fix:**
- Make the compat layer **unconditional**: add the block to Task 2 Step 5(c); change Task 4 Step 2 from "keep it if present" to "REQUIRE it — insert if the codemod didn't"; demote Task 9 Step 6-FIX to *verification* that it's working.
- Cheap coverage extension (recommended): in Task 1 Step 7 and Task 9 Step 5, also capture `http://localhost:3001/` and `/destinations/` full-page pairs (same pattern as the article pair) — that folds the placeholder/palette (O2) surfaces on uncovered pages into the same eyeball.

### H-3 — The deploy ships Atlas Phase 2 to prod for the first time, and the smoke never touches any Phase-2 surface

**Location:** Plan Task 13 Step 1 (9-URL list); relates to plan-author note 3 / Task 1 Step 4 / Task 11.

**Adjudication of the side-effect-deploy hazard (per review brief):** disclosure-at-STOP-gate is the **right** mitigation — a hard guard (rebase onto the deployed base / refuse until Phase 2 is live) would force deploying a branch whose history diverges from `main`, creating a worse merge problem, and the Phase-0 health-gate already makes Atlas degrade gracefully without secrets. CONFIRM the plan's approach, **but** it under-delivers on verification: the 9 smoke URLs (`/`, 5 locales, sitemap, robots, `/destinations/`) exercise *zero* Phase-2 code. "Smoke green" could coexist with the newly-shipped assistant brain 500-ing on every route nobody probed.

**Fix:** add to Task 13 Step 1 (and Task 15 Step 2's rollback smoke):
```bash
curl -s -o /dev/null -w "/api/assistant/health: %{http_code}\n" https://travelplaninfo.com/api/assistant/health
```
(route exists: `src/app/api/assistant/health/route.ts`). Expected: 200 with the health-gate's degraded-but-alive payload — NOT 5xx. Optionally have Jose's approval phrase acknowledge the rider explicitly ("go, incl. Phase 2 code").

### H-4 — v4 removes Preflight's `button { cursor: pointer }`; ~134 TPI buttons silently lose the pointer affordance and **no plan gate can detect it**

**Location:** Plan line 69 mentions "buttons `cursor: default`" in passing and defers to "Task 9's eyeball" — but a cursor is not renderable in a screenshot; the eyeball is structurally blind here.

**Evidence:** v3.4.19's installed `preflight.css` lines 340–345: "Set the default cursor for buttons." → `cursor: pointer;`. v4.3.1's `preflight.css`: rule absent (upgrade guide documents the change). Repo: **161 `<button>` occurrences, only 27 explicit `cursor-pointer`**. Every un-annotated button flips from pointer to arrow on desktop — a sitewide, user-perceivable interaction regression that violates the loop's "zero visual regression" bar in a dimension no gate covers (screenshots, e2e, lint, and unit are all cursor-blind).

**Fix:** pre-write the decision instead of leaving it to an eyeball that can't see it. Recommended: restore v3 behavior by default (one block, upgrade-guide-sanctioned), appended with the border compat layer:
```css
@layer base {
  button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer; }
}
```
Alternatively make it an explicit ACCEPT/RESTORE line-item in the Task 11 STOP-gate message. Silence is the only wrong option.

---

## Medium

### M-1 — The "only acceptable dirt" inventory is already stale; the codemod's clean-tree requirement will trip on unrelated banked docs

**Location:** Plan Task 1 Steps 1–2 (Expected blocks), Task 2 Steps 1 & 4, Task 10 Step 1.

**Defect:** the plan hardcodes `2026-07-07-phase3-monetization-loop-design.md` as the *single* unrelated untracked file and stashes exactly that path. The tree **today** already has six unrelated untracked docs (`factory-mcp` plan+spec, `phase2a-gsc-analytics` plan+spec, `phase3-monetization` plan+spec) plus `docs/superpowers/reviews/` — and this is a *banked* plan executing days later, on a repo where parallel loops bank more docs daily. `npx @tailwindcss/upgrade` refuses/prompts on a dirty tree; the one-file stash leaves it dirty, and several "Expected:" blocks become false, which for a one-task-per-dispatch Hermes means STOP-and-escalate noise at best.

**Fix:** generalize. In Task 2 Step 1 stash *all* unrelated untracked paths, e.g.:
```bash
git status --porcelain | awk '$1=="??" && $2 !~ /tailwind-4-upgrade/ {print $2}' \
  | xargs -r git stash push -u -m "tw4-park-unrelated" --
```
and reword the Expected blocks to "no unrelated untracked files remain" / "only unrelated banked docs remain untracked".

### M-2 — v4's `hover` variant no longer fires on touch devices; TPI has a verified hover-only reveal

**Location:** absent from spec §3 and the plan entirely.

**Evidence:** upgrade guide (verified via context7): v4 compiles `hover:` inside `@media (hover: hover)`. Repo: **311 `hover:` usages**; sweep finds ~7 reveal-ish patterns, of which `TripForm.tsx:415-419` is unambiguously functional — an info tooltip (`opacity-0 pointer-events-none group-hover:opacity-100`) that becomes **unreachable on touch devices** under v4 (v3-era tap-to-hover emulation no longer applies). Desktop-chromium Playwright cannot catch this; TPI's audience is mobile-heavy.

**Fix:** pre-write the decision: restore v3 semantics with the upgrade guide's own escape hatch — `@custom-variant hover (&:hover);` in `globals.css` (recommended for zero-regression fidelity) — or explicitly ACCEPT and disclose at the STOP-gate, with the TripForm tooltip named.

### M-3 — v4 cascade layers invert the body-font override; the plan's "custom CSS stays byte-identical" constraint preserves a live landmine

**Location:** Plan Task 2 Step 5(c) ("Everything from `* { box-sizing … }` down stays byte-identical") + Global Constraints "preserve" list; `src/app/globals.css` lines 10–12; `src/app/[locale]/layout.tsx:72`.

**Defect:** `<body className="… font-sans …">` vs. the **unlayered** `body { font-family: 'Inter', system-ui, … }` in globals.css. In v3 the `.font-sans` utility wins (class specificity beats the element selector). In v4, utilities live in `@layer utilities`, and *unlayered author CSS outranks all layers regardless of specificity* — the stale body rule now **wins**. Verified impact bound: Next 16 registers the literal families `Inter` + metrics-tuned `Inter Fallback` (`--font-inter:"Inter", "Inter Fallback"` in live CSS), so post-load glyphs stay Inter — but the tuned fallback chain is bypassed (worse font-swap shift), and the inversion is a standing trap for every future globals.css rule that competes with a utility.

**Fix:** amend the preserve-verbatim constraint with one sanctioned edit: **delete** the `body { font-family: … }` rule (the `font-sans` utility on `<body>` already supplies the correct stack; the rule only ever "worked" by losing) — or rewrite it to `var(--font-inter), system-ui, …`. Add one line to Task 4 Step 2's expectations noting that unlayered custom CSS now beats utilities (`.pac-*`, `.animate-*`, box-sizing are all fine — no utility competes with them; verified).

### M-4 — Rename-inventory arithmetic is wrong for bare `backdrop-blur`: it is 3 (3 files), not 4 (4 files), at the very commit the plan claims to have measured

**Location:** Plan "Measured rename inventory" table; Task 1 Step 8 Expected; Task 4 Step 4 Expected ("`backdrop-blur-sm 4`"); "≈175 renames".

**Evidence:** the plan's own grep, run twice at `4d5a1e7`: 3 hits — `Header.tsx:69`, `app/not-found.tsx:15`, `[locale]/destinations/page.tsx:264`. All other rows reproduce exactly (outline-none 64/14 files, shadow-sm 43/27, bare rounded 54, backdrop-blur-sm 8, bare shadow 1 @ TripForm.tsx:885, flex-shrink-0 1 @ ActivityCard.tsx:52). The stated post-codemod expectation `backdrop-blur-sm 4` would read as an off-by-one and send Hermes hunting a phantom missed rename (the plan's "main moved since the sweep" escape hatch doesn't apply — main did not move).

**Fix:** 4→3 and "4 files"→"3 files" in the inventory table and both expected blocks; ≈175→≈174.

### M-5 — Spec §3 needs a correction block: the "scale shift — changes rendering" mechanics are wrong (adjudicates plan-author note 1: CONFIRM)

**Location:** Spec §3 table + the bolded rationale lines; spec §3's O2 under-specification.

**Evidence (verified against v4.3.1 `theme.css`):** the renames are value-preserving when applied — v4 `--shadow-xs` = v3 `shadow-sm` (`0 1px 2px 0 rgb(0 0 0 / 0.05)`), v4 `--shadow-sm` = v3 bare `shadow`, `--radius-sm` 0.25rem = v3 bare `rounded`, `--blur-xs` 4px = v3 `blur-sm`. Stronger still: v4 ships a `/* Deprecated */` theme block (`--shadow`, `--blur`, `--radius` at exact v3 values), so even a **missed bare** token renders identically; only missed `*-sm` tokens and missed `outline-none` actually change rendering. Additional spec errors: the "blur-sm → blur-xs, 8/8 files" row is mislabeled (all 8 are `backdrop-blur-sm`; standalone `blur-sm` = 0); the `outline-none` row's "focus-ring semantics change" describes the *unapplied* hazard, not the rename; bare `rounded` (54) is missing entirely; and §3 never quantifies the border→`currentColor` exposure that is the actual top drift risk (213 bare `border`, 26 colorless sites). The visual re-baseline **remains mandatory** — but because of preflight/palette drift, not because of the renames.

**Fix:** one-paragraph spec edit restating the mechanics as above and adding the border exposure numbers. (This matters beyond hygiene: a future reader of the spec's current rationale could conclude re-baseline is skippable once renames verify as fully applied.)

---

## Low

### L-1 — Two rollback-path gaps around inconsistent VPS disk state

**Location:** Task 12 Step 3 (install failure: "capture the error and escalate"); Task 15.

**Defect:** after a failed `npm install` on the VPS, disk state is inconsistent (branch checkout + half-upgraded `node_modules`) while PM2 serves from memory — a crash/restart before resolution is an outage. "STOP and escalate" is necessary but not sufficient. Also: if Task 15's own rebuild fails, the plan is silent (PM2-memory-only is the last line); and Task 15 leaves the VPS detached at `PREV_SHA` indefinitely.

**Fix:** Task 12 Step 3 failure branch: "then run Task 15 Step 1 (checkout `PREV_SHA` + `npm install`) to restore consistent disk state before escalating." Task 15: add "if the rollback build itself fails: do NOT touch pm2 (it serves from memory); escalate immediately" and "during fix-forward, re-point the VPS at a branch/main rather than leaving it detached."

---

## Nit

### N-1 — Task 2 hang-recovery clean is under-scoped
`git checkout -- . && git clean -fd src/` misses root-level codemod artifacts (e.g. a freshly created `postcss.config.mjs`), so the re-run starts on a half-dirty tree the tool may refuse. Use `git clean -fd` repo-wide — safe at that point: this loop's docs are committed (Task 1 Step 2) and unrelated docs are stashed (M-1).

### N-2 — Task 9 checklist item 4 is vacuous as written
"No new visible focus outlines anywhere in the static captures" — nothing is focused in the captures, so this can never fail. Reframe: outline safety is proven by the Task 4 inventory reaching `outline-none = 0` / `outline-hidden = 64`; optionally add one manual Tab-through in the dev server during the STOP-gate review.

---

## Adjudication of the 10 plan-author notes

| # | Note | Ruling | Reasoning |
|---|---|---|---|
| 1 | Spec §3 "scale shift" imprecise; real risks = missed renames + preflight | **CONFIRM** | Verified in v4.3.1 theme: renames value-preserving; deprecated bare aliases keep exact v3 values (even stronger than the author claims). Spec must be corrected → M-5. |
| 2 | Fresh-sweep refinements (54 `rounded`, template-literal `shadow`, dead brand palette) | **CONFIRM, one correction** | All reproduce exactly (incl. `--color-brand-*` naming matching the nested `colors.brand.{…}` config, and 0 `*-brand-*` class usages) — except bare `backdrop-blur` is 3/3 not 4/4 → M-4. |
| 3 | Deploy-scope side effect (Phase 2 rides along); disclose at STOP-gate | **CONFIRM approach; harden verification** | Disclosure + park option is right; a hard guard (rebase onto deployed base) would be worse (divergent history). But the smoke must cover what's newly shipped → H-3. |
| 4 | Codemod TTY behavior unverified; fallbacks provided | **DOWNGRADE** | Fallback chain is adequate; but the manual fallback omits the preflight compat layer (→ H-2) and the hang-reset is under-scoped (→ N-1). |
| 5 | Eyeball delegated to vision-capable orchestrator | **REFUTE (as a defect)** | Sound design; checklist is concrete; Jose backstops. Residuals are N-2 (item 4 vacuous) and coverage (→ H-2), not the delegation. |
| 6 | Artifacts in `state/` not `/tmp` | **REFUTE (good deviation)** | Correct for a banked plan on a machine that sleeps/reboots. Keep. |
| 7 | O1 is inventory-diff, not exhaustive | **DOWNGRADE** | Proportionate given the accepted floor; both hard gates verified present in live v3 CSS. The real O1 problem is mechanical (wrong CSS glob) → H-1. |
| 8 | Visual snapshots run against dev server | **CONFIRM (acceptable)** | Parity with how baselines were generated; `toHaveScreenshot` disables CSS animations by default so the 3 custom keyframes don't threaten determinism. The live-CSS backstop must be fixed → B-1. |
| 9 | Version pins are plan-time latest | **REFUTE (non-issue)** | `^4.x` / latest-0.5.x resolution at execution handles staleness. |
| 10 | `prose` visual coverage invented via article-pair | **CONFIRM (good patch, thin)** | The 3 planner snapshots exercise zero `prose`; the article pair (route `[locale]/[slug]`, 30 prose usages) is the only typography gate and is proportionate. Extend the same pattern to `/` + `/destinations/` per H-2's coverage fix. |

---

## Verified-sound register (checked, no action needed)

- **213** bare-`border` count reproduces exactly (`grep -rnoP '(?<![\w-])border(?![\w-])' src/ --include='*.tsx'`); with side/width variants it's 251–271 — the headline number is honest.
- `TripForm.tsx:885` contains `bg-white shadow transition-transform` in a template literal, exactly as claimed; `ActivityCard.tsx:52` has the lone `flex-shrink-0`.
- **E2E census exact:** 38 behavioral (guest-flow 4 + planner-trust 12 + trip-api-dto 1 + articles 7 + auth 4 + home 6 + planner 4 — the four `.test.js` files DO run under Playwright's default `testMatch`) + 3 visual; vitest = 13 test files; no test references any renamed class.
- Visual spec/snapshot paths, test titles, and the `--grep-invert "baseline screenshot"` exclusion all match reality; snapshots are git-tracked on `main` (Task 9 Step 3's `git show` works).
- `guard_vps_deploy.py` deny regex is exactly `ssh.*104\.225\.221\.138.*(npm run build|pm2 restart|git pull.*&&)`; every SSH command in Tasks 12/14/15 clears it (`npx next build`, `pm2 reload`, `git pull` as final token).
- Smoke list matches `routing.ts` (`en` default `as-needed` + es/pt/fr/de/it), `trailingSlash: true`; `content/articles/` first entry is a slug JSON; `npm run dev -- --port 3001` is valid (`dev` script is bare `next dev`); local Node v22.23.1.
- **Dissolved leads** (independently hunted, verified NOT issues — do not re-flag): `max-w-screen-2xl` (planner page) still works in v4 as a deprecated functional utility resolving `--breakpoint-*` (verified in 4.3.1 `dist/lib.js`); `bg-gradient-to-*` (12 usages) is auto-aliased to `bg-linear-to-*` and v4 does **not** change default gradient interpolation (no `in oklab` default — oklab appears only in the explicit-modifier path and `color-mix` opacity); bare `ring` = 0 and every `ring-1/2` carries an explicit ring color (v4's ring width/color default change: zero exposure); `space-x/y` selector change is real (85 usages) but low-risk here — zero `hidden` co-occurrence, React conditional rendering removes nodes; add one Task 9 checklist line ("stacked-list spacing unchanged") rather than code changes; `divide-*` (2 usages) inherits the H-2 compat layer; `container` class 0 real usages; `<dialog>` 0; `theme()` 0; `[--var]` arbitrary 0; `!`-important prefix 0; `dark:` 0; typography 0.5.19→0.5.20 via `@plugin` is v4-compatible (≥0.5.10).

---

*Review artifacts: live HTML/CSS captures in the session scratchpad (`tpi-home.html`, `tpi-live.css`); Tailwind v4.3.1 inspection via `~/.hermes/hermes-agent/node_modules/tailwindcss/`.*
