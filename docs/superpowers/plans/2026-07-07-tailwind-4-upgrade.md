# TPI Tailwind CSS 3.4.19 → 4.x Upgrade Implementation Plan (Loop #2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Implementer:** Hermes GPT-5.5, **one task per dispatch**. Every task is self-contained: it re-states its own paths, re-derives its own state from the artifact directory, and never assumes shell state from a previous task. The dispatching orchestrator (Opus, vision-capable) reviews between tasks and personally performs the image-eyeball duty in Task 9.
>
> **Revision (2026-07-07):** incorporates the adversarial plan review `docs/superpowers/reviews/2026-07-07-tailwind-4-upgrade-plan-review.md` — B-1 (live-CSS assertion: chunks path + minification-proof markers), H-1 (`find .next/static` CSS glob), H-2 (unconditional border-compat + home/destinations eyeball coverage), H-3 (Phase-2 smoke probes), H-4 (button-cursor restore), M-1 (generalized untracked-docs stash), M-2 (`@custom-variant hover` restore), M-3 (body font-family deletion), M-4 (bare `backdrop-blur` = 3/3), M-5 (spec §3 correction), L-1, N-1, N-2 applied.

**Goal:** Upgrade travelplaninfo-prototype from `tailwindcss ^3.4.19` to v4.x (CSS-first config, `@tailwindcss/postcss`) with zero unintended visual regression, then deploy to the VPS/PM2 `tpi` process.

**Architecture:** Official codemod (`npx @tailwindcss/upgrade`) does the structural migration (deps, `tailwind.config.js` → `@theme`, PostCSS chain, ~174 utility renames), followed by a build → lint → unit → e2e → **visual re-baseline** fix-and-verify loop. The visual re-baseline + human eyeball is the real acceptance work — the config swap is mechanical. Hard human STOP-gate before the VPS deploy; deploy is split SSH commands (hook-compatible); pre-written rollback.

**Tech Stack:** Tailwind CSS 4.x (4.3.2 at plan time), `@tailwindcss/postcss`, `@tailwindcss/typography` 0.5.20, Next.js 16.2.x, Playwright 1.58 (visual snapshots), Vitest 4, PM2/Apache on VPS 104.225.221.138.

---

## Global Constraints

Copied from spec `docs/superpowers/specs/2026-07-07-tailwind-4-upgrade-design.md` (source of truth). Every task's requirements implicitly include this section.

- `tailwindcss ^3.4.19` → `^4.x` (latest 4.x at execution time; 4.3.2 as of 2026-07-07).
- **Add** `@tailwindcss/postcss` (the v4 PostCSS plugin). **Remove** `autoprefixer` (v4 vendor-prefixes natively via Lightning CSS) — Task 5 verifies no needed prefixes drop (spec open question O1).
- `@tailwindcss/typography ^0.5.19` → latest v4-compatible 0.5.x (0.5.20 as of 2026-07-07), re-wired via `@plugin`.
- `postcss` **stays** in `package.json` (Next.js PostCSS processor).
- `tailwind.config.js` (CJS) → CSS-first `@theme` in `src/app/globals.css`: 5 brand colors (`cream`, `cream-light`, `orange`, `teal`, `dark`) + 2 font stacks (`var(--font-inter)`, `var(--font-playfair)`). Content auto-detection in v4 — add `@source` only if a glob is missed.
- `src/app/globals.css` must **preserve**: the `* { box-sizing: border-box }` reset, the 3 `@keyframes` (`help-pulse`, `atlas-float`, `bubble-pop`) with their `.animate-*` classes, and the Google Places `.pac-*` overrides. **One sanctioned deletion** (review M-3): the unlayered `body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }` rule MUST be deleted — under v4 cascade layers, unlayered author CSS outranks ALL layers, so this rule (which in v3 always lost to the `font-sans` utility on `<body>`) would start winning and bypass next/font's metrics-tuned `Inter Fallback` chain. The `font-sans` utility already supplies the correct stack.
- `src/app/globals.css` must **gain the unconditional v4-compat block** (review H-2/H-4/M-2): v3 default border-color, v3 button `cursor: pointer`, and `@custom-variant hover (&:hover);` (v3 hover-on-touch semantics). Exact content in Task 2 Step 5(c); Task 4 Step 2 REQUIREs it on the codemod path; Task 9 verifies it. It ships by default — NOT conditionally on an eyeball: a cursor is invisible in screenshots, and touch-only hover breakage is invisible to desktop Playwright, so no gate can catch these after the fact.
- Browser floor Safari 16.4+ / Chrome 111+ / Firefox 128+: **accepted by Jose 2026-07-07** — not a blocker, but O1 verification still runs.
- The 3 Playwright visual baselines (`tests/e2e/visual-baseline.spec.ts-snapshots/planner-tripId-{1280,1440,1920}-chromium-linux.png`) MUST be regenerated **and manually eyeballed** (spec success criterion 4). Spec §3: "Visual re-baseline is MANDATORY, not optional." Before/after full-page screenshot pairs for `/`, `/destinations/`, and one article page are part of the same eyeball (review H-2 — the ~26 colorless-border elements live mostly in home/destinations-only components the planner snapshots never render).
- Verification gates: `npm run build` clean · `npm run lint` no new problems vs baseline · `npm run test:unit` 13/13 test files · `npm run test:e2e` green · visual baselines regenerated + eyeballed (incl. home/destinations/article pairs) · VPS smoke: 9 core URLs all 200 + 2 Phase-2 probes (`/api/assistant/health`, `/planner/`) non-5xx (review H-3).
- **Out of scope** (held to their own later loops): TypeScript 5→6, ESLint 9→10, `@types/node` 20→24, React bumps, `middleware.ts` → `proxy.ts`.
- **Branch:** `chore/tailwind-4-upgrade` (matches the `chore/next-16-upgrade` convention).
- **Hard STOP-gate before any VPS action** per `feedback_no_deploy_without_review`. The `guard_vps_deploy.py` hook workaround (Task 12) is used only AFTER Jose's explicit go-ahead — it exists because the hook's regex is blunter than the policy, never to bypass the policy.
- **Artifact directory** (survives reboots — this plan may execute days after being banked): `/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/`. Do NOT use `/tmp` for anything a later task needs (the workstation is not 24/7; `/tmp` clears on reboot).
- Commit attribution for all commits in this plan: `Co-Authored-By: Hermes GPT-5.5 <noreply@openai.com>`.

---

## File / config inventory (read once before starting)

Everything the upgrade touches or verifies. Anything not on this list should NOT be edited during this plan (exception: the codemod's mechanical class renames across `src/**/*.tsx`, inventoried below).

| Path | Role | Expected change |
| --- | --- | --- |
| `/home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype/package.json` | deps | `tailwindcss` → ^4.x; add `@tailwindcss/postcss`; remove `autoprefixer`; `@tailwindcss/typography` → ^0.5.20; `postcss` unchanged |
| `.../package-lock.json` | lockfile | Regenerated by `npm install` |
| `.../postcss.config.js` | PostCSS chain | `{ tailwindcss:{}, autoprefixer:{} }` → `{ '@tailwindcss/postcss':{} }` |
| `.../tailwind.config.js` | v3 JS config | **Deleted** (fully migrated into `@theme`) |
| `.../src/app/globals.css` | single CSS file | `@tailwind` directives → `@import "tailwindcss"` + `@plugin "@tailwindcss/typography"` + `@theme` block + unconditional v4-compat block (border-color / button cursor / `@custom-variant hover`); custom CSS below preserved with ONE sanctioned deletion (unlayered `body { font-family }` rule — M-3) |
| `.../src/**/*.tsx` (~45 files) | components/pages | Codemod class renames only (inventory below) |
| `.../src/components/TripForm.tsx:885` | 1 bare `shadow` in a template literal | → `shadow-sm`; watch: codemod may skip dynamic contexts (Task 4 has the manual fix) |
| `.../tests/e2e/visual-baseline.spec.ts-snapshots/planner-tripId-{1280,1440,1920}-chromium-linux.png` | visual baselines | Regenerated in Task 9 |
| `.../playwright.config.ts` | E2E config | No edits. `baseURL http://localhost:3001`, **no `webServer` block** — dev server started manually; `workers: 1` |
| `.../vitest.config.ts` | unit config | No edits. `include: src/**/*.test.{ts,tsx}` → 13 files |
| `.../src/app/[locale]/layout.tsx` | next/font wiring (`--font-inter`, `--font-playfair`) | No edits — `@theme` font tokens reference these vars |
| `.../scripts/deploy-vps.sh` | reference deploy script | Not executed (see Task 12 preamble); no edits |
| `/home/jarvis/.claude/hooks/guard_vps_deploy.py` | PreToolUse deploy gate | Read-only; its regex shapes Task 12's command splitting |

**Measured rename inventory** (fresh sweep 2026-07-07 @ `4d5a1e7`, `src/` only — refines spec §3 with exact splits):

| v3 token | Count | Files | v4 token (codemod applies) |
| --- | --- | --- | --- |
| `outline-none` | 64 | 14 | `outline-hidden` |
| `shadow-sm` | 43 | 27 | `shadow-xs` |
| bare `rounded` | 54 | many | `rounded-sm` |
| `backdrop-blur-sm` | 8 | 8 | `backdrop-blur-xs` |
| bare `backdrop-blur` | 3 | 3 | `backdrop-blur-sm` |
| bare `shadow` | 1 | `TripForm.tsx:885` (template literal) | `shadow-sm` |
| `flex-shrink-0` | 1 | `ActivityCard.tsx:52` | `shrink-0` |
| `rounded-sm`, standalone `blur-sm`, bare `ring`, `drop-shadow-sm`, `bg-opacity-*`/`text-opacity-*` | 0 | — | n/a |

≈174 renames total. Every rename is value-preserving **when applied** (v4 even ships deprecated bare aliases — `--shadow`, `--blur`, `--radius` — at exact v3 values, so a missed *bare* token still renders identically; only a missed `*-sm` token or a missed `outline-none` changes rendering). The visual risk is (a) a missed `*-sm`/`outline-none` occurrence now silently rendering at the v4 meaning of the old name, and (b) v4 preflight/palette drift independent of renames (spec O2):
- default border-color `gray-200` → `currentColor` — **213 bare `border*` usages in TPI, of which ~26 border-carrying elements have no color utility on the element, mostly in home/destinations-only components** (`TrendingDestinations.tsx`, `DestinationSuggestions.tsx`, `SurpriseMeQuiz.tsx`, `PackageDealsCarousel.tsx`, `OnboardingModal.tsx`, `atlas/TripResultsModal.tsx`) — the single biggest drift risk;
- preflight no longer sets `button { cursor: pointer }` — **161 `<button>` occurrences, only 27 explicit `cursor-pointer`**; a cursor cannot appear in any screenshot, so no gate can see this (review H-4);
- `hover:` variants now compile inside `@media (hover: hover)` — 311 usages; the `TripForm.tsx:415-419` info tooltip is hover-revealed and would become unreachable on touch devices (review M-2);
- placeholder color `gray-400` → `currentColor/50`; stock palette moved to oklch.

The first three are neutralized structurally by the **unconditional v4-compat block** in `globals.css` (Task 2 Step 5(c) content; Task 4 Step 2 requires it; Task 9 Step 6 verifies it). Residual palette/placeholder drift is adjudicated by Task 9's eyeball — which now includes home + destinations screenshot pairs (review H-2), since the colorless-border surfaces live outside the 3 planner snapshots.

**Tests are clean:** no Playwright locator or unit test references any renamed class name (verified by sweep). Vitest suite is style-agnostic.

**E2E suite shape** (for baseline expectations): 8 spec files; ~38 behavioral tests (`guest-flow` 4, `planner-trust` 12, `trip-api-dto` 1, `articles` 7, `auth` 4, `home` 6, `planner` 4) + 3 visual tests (`visual-baseline.spec.ts`, one per width). The counts recorded in Task 1 are authoritative if they differ.

---

## Task 1: Pre-flight baseline + feature branch

**Goal:** Prove the v3 world is green (build, lint, unit, e2e **including the 3 visual snapshots**), capture rollback anchors + comparison baselines (vendor-prefix inventory, rename inventory, article-page screenshot), and branch.

**Files:**
- `git add` of `docs/superpowers/specs/2026-07-07-tailwind-4-upgrade-design.md` + this plan file (committed to `main` before branching). No source edits.

**Interfaces:**
- Consumes: clean `main` @ `4d5a1e7` or later.
- Produces (in `ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts`): `preflight-local-sha.txt`, `preflight-vps-sha.txt`, `preflight-vps-drift.txt`, `preflight-pm2.txt`, `preflight-timer.txt`, `baseline-build.log`, `baseline-prefixes.txt`, `baseline-lint.log`, `baseline-unit.log`, `baseline-e2e.log`, `baseline-e2e-counts.txt`, `baseline-article-v3.png`, `baseline-home-v3.png`, `baseline-destinations-v3.png`, `rename-inventory-pre.txt`; branch `chore/tailwind-4-upgrade`.

- [ ] **Step 1: Create the artifact directory and inspect the working tree**

```bash
mkdir -p /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git status --short
git log --oneline -1
```
Expected: HEAD is `4d5a1e7` (or a later `main` commit). Untracked entries will include this loop's docs (spec, plan, review) **plus several unrelated banked docs from parallel loops** (as of plan revision: factory-mcp plan+spec, phase2a-gsc-analytics plan+spec, phase3-monetization plan+spec — the exact set varies daily; do NOT hardcode or expect a fixed list — review M-1). Record what is there; Step 2 commits only this loop's docs, and Task 2 Step 1 stashes every unrelated leftover before the codemod runs.
If there are `M` entries on `src/` files: STOP — unrelated work in flight; ask Jose before proceeding.

- [ ] **Step 2: Commit this loop's docs to `main` (docs-only: spec + plan + review)**

Commit THIS loop's three docs only. Do NOT include the unrelated banked docs from other loops (review M-1).
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git add docs/superpowers/specs/2026-07-07-tailwind-4-upgrade-design.md \
        docs/superpowers/plans/2026-07-07-tailwind-4-upgrade.md \
        docs/superpowers/reviews/2026-07-07-tailwind-4-upgrade-plan-review.md
git commit -m "docs(tpi): add Tailwind 4 upgrade spec + plan + review (Loop #2)

Brainstorm spec, implementation plan, and adversarial plan review for the
tailwindcss 3.4.19 -> 4.x upgrade. Docs-only commit on main; upgrade work
happens on a branch.

Co-Authored-By: Hermes GPT-5.5 <noreply@openai.com>"
git status --short
```
Expected: after the commit, nothing matching `tailwind-4-upgrade` remains untracked; the only untracked entries are unrelated banked docs from other loops (count varies — some may have been committed by their own loops in the meantime; any residue is handled by Task 2 Step 1's stash).

- [ ] **Step 3: Capture the local rollback anchor SHA**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git rev-parse HEAD | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/preflight-local-sha.txt
```
Expected: a 40-char SHA written to the file.

- [ ] **Step 4: Capture VPS rollback anchor + PM2 + timer state + main-vs-VPS drift**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git rev-parse HEAD" | tee "$ART/preflight-vps-sha.txt"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "pm2 list" | tee "$ART/preflight-pm2.txt"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "systemctl status tpi-schedule-runner.timer --no-pager" | tee "$ART/preflight-timer.txt"
git fetch origin
git log --oneline "$(cat "$ART/preflight-vps-sha.txt")"..HEAD | tee "$ART/preflight-vps-drift.txt"
```
Expected: VPS SHA is 40 chars (the rollback target); `pm2 list` shows `tpi` `online`; timer `active (waiting)`.
**Drift check:** `preflight-vps-drift.txt` lists every `main` commit not yet deployed. As of plan-writing, the Atlas Phase 2 brain-relocation merge (`e50a868`) and review-fix merge (`4d5a1e7`) are expected to be UNDEPLOYED (VPS secrets were pending). **Deploying this branch deploys all of them too.** Do not resolve this here — record it; Task 11's STOP-gate presents it to Jose verbatim.
If SSH fails: STOP — fix SSH access first; the deploy half of this plan is blocked. If `tpi` is not `online` or the timer is not `active (waiting)`: STOP and flag to Jose.

- [ ] **Step 5: Baseline build + v3 vendor-prefix inventory (O1 comparison anchor)**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
npm run build 2>&1 | tee "$ART/baseline-build.log" | tail -15
echo "exit=$?"
find .next/static -name '*.css' -exec cat {} + | grep -oE '\-(webkit|moz|ms|o)-[a-z-]+' | sort -u | tee "$ART/baseline-prefixes.txt"
```
(`find`, NOT `cat .next/static/css/*.css` — Next 16/Turbopack emits CSS under `.next/static/chunks/`, so the `static/css/` glob matches nothing; review B-1/H-1.)
Expected: build exit 0 with a `Route (app)` table. The prefix inventory is what autoprefixer + v3 currently emit (expect at least `-webkit-backdrop-filter` and `-webkit-line-clamp` — TPI uses 12 `backdrop-blur*` and 7 `line-clamp*` utilities; both verified present in today's live v3 CSS). Task 5 diffs the v4 output against this file.
If `baseline-prefixes.txt` comes out empty: the find/grep is wrong or the build emitted no CSS — STOP and inspect `.next/static` before proceeding (an empty baseline would make the O1 diff vacuous).
If build FAILS: STOP — the tree is broken before any upgrade work.

- [ ] **Step 6: Baseline lint + unit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
npm run lint 2>&1 | tee "$ART/baseline-lint.log"; echo "lint-exit=$?"
npm run test:unit 2>&1 | tee "$ART/baseline-unit.log" | tail -10; echo "unit-exit=$?"
```
Expected: lint completes (record the problem-summary line — warnings may exist; the count is the baseline for Task 6). Unit shows `Test Files  13 passed (13)` and `unit-exit=0`.
If unit FAILS: STOP — pre-existing failures must be resolved or explicitly waived by Jose.

- [ ] **Step 7: Baseline E2E — FULL suite (must include the 3 visual tests passing) + v3 article/home/destinations screenshots**

`playwright.config.ts` has no `webServer` block; start the dev server manually on 3001. The visual tests passing here proves the committed snapshots are still deterministic — the comparison anchor for Task 9.
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
sleep 2
npm run dev -- --port 3001 > "$ART/baseline-dev.log" 2>&1 &
echo $! > "$ART/dev-pid.txt"
sleep 15
curl -s -o /dev/null -w 'dev-up: %{http_code}\n' http://localhost:3001/
npm run test:e2e 2>&1 | tee "$ART/baseline-e2e.log" | tail -15
echo "e2e-exit=$?"
SLUG=$(ls content/articles/ | head -1 | sed 's/\.json$//')
echo "article-slug=$SLUG" | tee "$ART/article-slug.txt"
npx playwright screenshot --viewport-size=1280,900 --full-page "http://localhost:3001/$SLUG/" "$ART/baseline-article-v3.png"
npx playwright screenshot --viewport-size=1280,900 --full-page "http://localhost:3001/" "$ART/baseline-home-v3.png"
npx playwright screenshot --viewport-size=1280,900 --full-page "http://localhost:3001/destinations/" "$ART/baseline-destinations-v3.png"
kill "$(cat "$ART/dev-pid.txt")" 2>/dev/null; sleep 1
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
grep -E 'passed|failed|skipped' "$ART/baseline-e2e.log" | tail -3 | tee "$ART/baseline-e2e-counts.txt"
```
Expected: `dev-up: 200`; Playwright summary shows all tests `passed` (≈41 total: ~38 behavioral + 3 visual; the recorded number is authoritative) with **zero visual-baseline failures**; all three screenshot files exist — the article pair is the prose/typography reference, and the home + destinations pairs are the O2 border/palette reference (review H-2: the ~26 colorless-border elements live mostly in home/destinations-only components the planner snapshots never render).
If the visual tests fail on clean `main`: STOP — the snapshots are stale/non-deterministic; re-baselining on v3 first (with Jose's awareness) is a prerequisite, otherwise Task 9's before/after comparison is meaningless.
If behavioral tests fail: STOP — resolve or get Jose's explicit waiver before upgrading.

- [ ] **Step 8: Capture the pre-upgrade rename inventory**

Run this exact block (Task 4 re-runs it verbatim for the post-codemod comparison):
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
{
  echo "outline-none        $(grep -rn 'outline-none' src/ | wc -l)"
  echo "outline-hidden      $(grep -rn 'outline-hidden' src/ | wc -l)"
  echo "flex-shrink-0       $(grep -rn 'flex-shrink-0' src/ | wc -l)"
  echo "shadow-sm           $(grep -rnP '(?<![\w-])shadow-sm(?![\w-])' src/ | wc -l)"
  echo "shadow-xs           $(grep -rnP '(?<![\w-])shadow-xs(?![\w-])' src/ | wc -l)"
  echo "bare-shadow         $(grep -rnP '(?<![\w-])shadow(?![\w-])' src/ --include='*.tsx' --include='*.ts' | wc -l)"
  echo "backdrop-blur-sm    $(grep -rn 'backdrop-blur-sm' src/ | wc -l)"
  echo "backdrop-blur-xs    $(grep -rn 'backdrop-blur-xs' src/ | wc -l)"
  echo "bare-backdrop-blur  $(grep -rnP '(?<![\w-])backdrop-blur(?![\w-])' src/ | wc -l)"
  echo "rounded-sm          $(grep -rnP '(?<![\w-])rounded-sm(?![\w-])' src/ | wc -l)"
  echo "rounded-xs          $(grep -rnP '(?<![\w-])rounded-xs(?![\w-])' src/ | wc -l)"
  echo "bare-rounded        $(grep -rnP '(?<![\w-])rounded(?![\w-])' src/ | wc -l)"
} | tee "$ART/rename-inventory-pre.txt"
```
Expected values (measured 2026-07-07 @ `4d5a1e7`, re-verified by the adversarial review): `outline-none 64`, `outline-hidden 0`, `flex-shrink-0 1`, `shadow-sm 43`, `shadow-xs 0`, `bare-shadow 1`, `backdrop-blur-sm 8`, `backdrop-blur-xs 0`, `bare-backdrop-blur 3`, `rounded-sm 0`, `rounded-xs 0`, `bare-rounded 54`. Small deviations mean `main` moved since the sweep — record the actual numbers; they become the authoritative "pre" column.

- [ ] **Step 9: Create the feature branch**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git checkout -b chore/tailwind-4-upgrade
git log --oneline -1
```
Expected: HEAD on `chore/tailwind-4-upgrade`, same commit as `main` (the docs commit from Step 2).

---

## Task 2: Run the official codemod (`npx @tailwindcss/upgrade`)

**Goal:** Let the official upgrade tool do the structural migration in one shot: dependency updates, `tailwind.config.js` → `@theme` CSS, PostCSS chain rewrite, typography `@plugin` wiring, and the ~174 template class renames. Commit its output as a single reviewable commit.

**Files:**
- Modified by the tool (expected): `package.json`, `package-lock.json`, `postcss.config.js` (or replaced by `postcss.config.mjs`), `src/app/globals.css`, ~45 files under `src/`
- Deleted by the tool (expected): `tailwind.config.js`

**Interfaces:**
- Consumes: branch `chore/tailwind-4-upgrade` from Task 1; clean tree.
- Produces: one commit containing the full codemod output; `ART/codemod.log` (the tool's stdout including any "could not migrate" warnings — Task 4 reads it).

- [ ] **Step 1: Preconditions — Node version + clean tree**

The upgrade tool requires Node.js 20+ and refuses to run on a dirty tree.
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
node --version
git status --short
git branch --show-current
```
Expected: Node v20+ (v22.23.1 locally); branch is `chore/tailwind-4-upgrade`. The only acceptable dirt is **unrelated untracked banked docs from other loops** (several exist; parallel loops bank more daily — do NOT expect any fixed list; review M-1). This loop's own docs were committed in Task 1 Step 2, so nothing matching `tailwind-4-upgrade` should be untracked. Park ALL unrelated untracked paths so the tool sees a clean tree:
```bash
git status --porcelain | awk '$1=="??" && $2 !~ /tailwind-4-upgrade/ {print $2}' \
  | xargs -r git stash push -u -m "tw4-park-unrelated" --
git status --short
```
Expected after: `git status --short` prints nothing — **no unrelated untracked files remain**. If anything is still listed, resolve it before Step 2: the upgrade tool refuses/prompts on a dirty tree.

- [ ] **Step 2: Run the codemod**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
npx @tailwindcss/upgrade 2>&1 | tee "$ART/codemod.log"
echo "codemod-exit=$?"
```
Expected: exit 0. The log shows it migrated the config, PostCSS setup, CSS file, and template files, and updated dependencies. Warning lines about classes it could not safely migrate (dynamic/template-literal contexts) are acceptable — record them; Task 4 verifies each one (the known candidate is the bare `shadow` in `src/components/TripForm.tsx:885`).
**If the command hangs >5 minutes or dies on a TTY error** (this environment is non-TTY; the Next-16 loop hit this with `@next/codemod`): kill it, reset (`git checkout -- . && git clean -fd && git status --short` — confirm clean; repo-wide `git clean -fd` is safe here AND necessary: it also removes root-level codemod artifacts like a freshly created `postcss.config.mjs` that `git clean -fd src/` would miss — review N-1. Safe because this loop's docs are committed and unrelated docs are stashed), and re-run under an emulated TTY:
```bash
script -qec "npx @tailwindcss/upgrade" "$ART/codemod-tty.log"
echo "codemod-exit=$?"
cp "$ART/codemod-tty.log" "$ART/codemod.log"
```
**If it still cannot run:** go to Step 5 (full manual fallback), then continue with Step 3.

- [ ] **Step 3: Review what the tool did**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git status --short | head -60
git diff --stat | tail -8
git diff -- package.json postcss.config.js postcss.config.mjs 2>/dev/null
git diff -- src/app/globals.css
grep -inE 'could not|warn|manual|skipped' /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/codemod.log | head -20
```
Expected: `tailwind.config.js` deleted or fully emptied into CSS; `globals.css` now starts with `@import "tailwindcss"` (+ `@plugin "@tailwindcss/typography"`) and contains an `@theme` block with the 5 `--color-brand-*` tokens and 2 `--font-*` stacks; the custom CSS below (box-sizing, keyframes, `.pac-*`) untouched; `package.json` shows tailwindcss ^4, `@tailwindcss/postcss` added. The tool may also have inserted **preflight-compatibility CSS** (e.g. a `@layer base` border-color block) — KEEP anything it inserted; its border-color piece counts toward the REQUIRED v4-compat block, and Task 4 Step 2 completes whatever is missing (button cursor + `@custom-variant hover` — the codemod does not insert those). Deep verification is Task 4's job — this step only confirms the migration ran end-to-end and nothing outside the inventory list was touched.
If files OUTSIDE the File/config inventory changed (other than `src/**/*.tsx` renames): investigate before committing; revert anything unrelated.

- [ ] **Step 4: Unpark the stash (if Step 1 stashed) and commit the codemod output**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git stash list | grep -q tw4-park-unrelated && git stash pop
git add -A -- package.json package-lock.json postcss.config.js postcss.config.mjs tailwind.config.js src/
git status --short
git commit -m "chore(tpi): run npx @tailwindcss/upgrade (tailwind 3.4 -> 4)

Official codemod output, single atomic commit:
- deps: tailwindcss ^4, add @tailwindcss/postcss, drop autoprefixer
- tailwind.config.js -> CSS-first @theme in globals.css (5 brand colors,
  2 font stacks); typography via @plugin
- postcss chain -> @tailwindcss/postcss
- ~174 utility renames across src/ (outline-none->outline-hidden,
  shadow-sm->shadow-xs, rounded->rounded-sm, backdrop-blur renames,
  flex-shrink-0->shrink-0)

Co-Authored-By: Hermes GPT-5.5 <noreply@openai.com>"
```
Expected: commit succeeds; `git status --short` afterwards shows only the unrelated banked docs (if the stash was popped back) — never commit those files in this plan.

- [ ] **Step 5: Conditional — full manual fallback (ONLY if the codemod cannot run at all)**

Skip this step entirely if Step 2 succeeded. Apply these five edits by hand, in this order:

(a) **`package.json`** — in `dependencies`: change `"tailwindcss": "^3.4.19"` → `"tailwindcss": "^4.3.2"`; add `"@tailwindcss/postcss": "^4.3.2"` (alphabetical: after `@googlemaps/js-api-loader`, next to `@tailwindcss/typography`); change `"@tailwindcss/typography": "^0.5.19"` → `"^0.5.20"`; delete the `"autoprefixer": "^10.4.24",` line. Leave `"postcss": "^8.5.6"` in place.

(b) **`postcss.config.js`** — replace the entire file with:
```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

(c) **`src/app/globals.css`** — replace the first three lines (`@tailwind base;`, `@tailwind components;`, `@tailwind utilities;`) with:
```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@custom-variant hover (&:hover);

@theme {
  --font-sans: var(--font-inter), system-ui, -apple-system, sans-serif;
  --font-serif: var(--font-playfair), Georgia, serif;

  --color-brand-cream: #F5F0EB;
  --color-brand-cream-light: #FAF5EF;
  --color-brand-orange: #EA580C;
  --color-brand-teal: #0F766E;
  --color-brand-dark: #111827;
}

/* Tailwind v4 upgrade compat: restore v3 defaults (spec O2; review H-2/H-4/M-2).
   Unconditional — do NOT gate on an eyeball (cursor + touch-hover are invisible to every gate). */
@layer base {
  /* v3 default border color (upgrade-guide snippet) — 213 bare border* usages */
  *,
  ::after,
  ::before,
  ::backdrop,
  ::file-selector-button {
    border-color: var(--color-gray-200, currentColor);
  }
  /* v3 button cursor (upgrade-guide snippet) — 161 <button>s, only 27 explicit cursor-pointer */
  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}
```
(The top-level `@custom-variant hover (&:hover);` restores v3 hover semantics — v4's default wraps `hover:` in `@media (hover: hover)`, which would make the hover-revealed info tooltip at `TripForm.tsx:415-419` unreachable on touch devices; review M-2.)
Everything from `* { box-sizing: border-box; }` down stays byte-identical, with **ONE sanctioned deletion** (review M-3): remove the
```css
body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
```
rule entirely — under v4 cascade layers, this unlayered rule would outrank the `font-sans` utility on `<body>` (in v3 it always lost on specificity) and bypass next/font's metrics-tuned `Inter Fallback` chain. The `font-sans` utility already supplies the correct stack.

(d) **Delete `tailwind.config.js`**: `git rm tailwind.config.js`. (v4 auto-detects content; TPI's `src/` layout needs no `@source`.)

(e) **Class renames** — order matters: `-sm → -xs` renames MUST run before `bare → -sm` renames, otherwise a freshly-renamed token gets renamed twice.
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
grep -rlP 'outline-none|flex-shrink-0|backdrop-blur|shadow-sm|(?<![\w-])rounded(?![\w-])' src/ --include='*.tsx' --include='*.ts' > /tmp/tw4-files.txt
xargs -a /tmp/tw4-files.txt perl -pi -e 's/(?<![\w-])backdrop-blur-sm(?![\w-])/backdrop-blur-xs/g'
xargs -a /tmp/tw4-files.txt perl -pi -e 's/(?<![\w-])shadow-sm(?![\w-])/shadow-xs/g'
xargs -a /tmp/tw4-files.txt perl -pi -e 's/(?<![\w-])backdrop-blur(?![\w-])/backdrop-blur-sm/g'
xargs -a /tmp/tw4-files.txt perl -pi -e 's/(?<![\w-])rounded(?![\w-])/rounded-sm/g'
xargs -a /tmp/tw4-files.txt perl -pi -e 's/(?<![\w-])outline-none(?![\w-])/outline-hidden/g'
xargs -a /tmp/tw4-files.txt perl -pi -e 's/(?<![\w-])flex-shrink-0(?![\w-])/shrink-0/g'
```
Do NOT run a repo-wide rename for bare `shadow` or bare `blur` — the only bare-`blur` match in `src/` is a JavaScript `.blur()` call (not a class) and a blind regex would corrupt it. Instead apply the single bare-`shadow` rename by hand: in `src/components/TripForm.tsx` line 885, inside the template literal `className`, change ` bg-white shadow transition-transform ` → ` bg-white shadow-sm transition-transform `.
Then review for regex collateral damage before proceeding: `git diff | grep -E '^\+' | grep -vE 'outline-hidden|shadow-xs|shadow-sm|backdrop-blur|rounded-sm|shrink-0' | head -20` — any hit that isn't a class rename means a false positive; fix it manually.
Finally: `npm install` (regenerates the lockfile for the new deps), then commit with the Step 4 message (replace the first line's description with "manual migration (codemod unavailable)").

---

## Task 3: Dependency reconciliation + install

**Goal:** Bring `package.json` to the exact spec §4 end-state (the codemod usually does most of this — verify and top up), then install and prove the resolved versions.

**Files:**
- `/home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype/package.json` — top-up edits only if the codemod missed something
- `.../package-lock.json` — regenerated

**Interfaces:**
- Consumes: Task 2's codemod commit.
- Produces: installed `node_modules` at v4; `ART/npm-install.log`, `ART/resolved-versions.txt`; a top-up commit only if edits were needed.

- [ ] **Step 1: Audit `package.json` against the spec §4 target state**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
grep -nE 'tailwindcss|autoprefixer|postcss|typography' package.json
npm view @tailwindcss/typography version
npm view tailwindcss version
```
Required end-state (either dependency section is acceptable — the codemod may move packages to `devDependencies`; do not fight it):
- `tailwindcss` at `^4.x` — present
- `@tailwindcss/postcss` at `^4.x` — present
- `autoprefixer` — ABSENT (any section)
- `@tailwindcss/typography` at `^0.5.20` or later 0.5.x — present
- `postcss` — still present (spec: "postcss stays")

Apply the minimum edits to reach that state (e.g. if the codemod left `autoprefixer`, delete its line; if typography wasn't bumped, set `"@tailwindcss/typography": "^0.5.20"` using the version `npm view` printed).

- [ ] **Step 2: Install + verify resolved versions**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
npm install 2>&1 | tee "$ART/npm-install.log" | tail -10
echo "exit=$?"
{
  node -e "console.log('tailwindcss', require('./node_modules/tailwindcss/package.json').version)"
  node -e "console.log('@tailwindcss/postcss', require('./node_modules/@tailwindcss/postcss/package.json').version)"
  node -e "console.log('@tailwindcss/typography', require('./node_modules/@tailwindcss/typography/package.json').version)"
  node -e "try { require.resolve('autoprefixer'); console.log('autoprefixer STILL INSTALLED') } catch { console.log('autoprefixer absent — OK') }"
} | tee "$ART/resolved-versions.txt"
```
Expected: exit 0; `tailwindcss` 4.x (4.3.2 or later), `@tailwindcss/postcss` 4.x, `@tailwindcss/typography` 0.5.20+, `autoprefixer absent — OK`.
Note: `autoprefixer` may remain in `node_modules` as a transitive dep of another package even after removal from `package.json` — if `require.resolve` finds it, check `npm ls autoprefixer`; a transitive-only entry is acceptable (it just must not be in TPI's `package.json` or `postcss.config.js`).
If peer-dep errors on tailwindcss/typography: re-check versions against `npm view` output; typography <0.5.10 is NOT v4-compatible.

- [ ] **Step 3: Commit (only if Step 1 made edits)**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git status --short
git add package.json package-lock.json
git commit -m "chore(tpi): reconcile tailwind 4 dependency set with spec

- <one line per top-up edit: e.g. remove autoprefixer / bump typography to 0.5.20>

Co-Authored-By: Hermes GPT-5.5 <noreply@openai.com>"
```
If `package.json` needed no edits and only `package-lock.json` moved, commit the lockfile alone with subject `chore(tpi): refresh lockfile after tailwind 4 install`. If nothing changed, skip.

---

## Task 4: Config-transform verification

**Goal:** Prove the four config surfaces landed exactly (PostCSS chain, `globals.css` structure, `tailwind.config.js` gone, class-rename inventory), and fix any codemod misses with pre-written edits.

**Files (verify; edit only on misses):**
- `/home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype/postcss.config.js` (or `.mjs`)
- `.../src/app/globals.css`
- `.../tailwind.config.js` (must be gone)
- `.../src/components/TripForm.tsx` (known codemod-miss candidate)

**Interfaces:**
- Consumes: Tasks 2–3 commits; `ART/rename-inventory-pre.txt`, `ART/codemod.log`.
- Produces: `ART/rename-inventory-post.txt`; a fix commit only if misses were found.

- [ ] **Step 1: PostCSS chain**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ls postcss.config.* && cat postcss.config.*
```
Expected: exactly ONE postcss config file, whose only plugin is `@tailwindcss/postcss` (object form, e.g. `plugins: { '@tailwindcss/postcss': {} }` — the `.mjs`/`export default` variant the codemod sometimes writes is equally fine). No `tailwindcss` legacy plugin, no `autoprefixer`.
If wrong: replace the file body with the Task 2 Step 5(b) content.

- [ ] **Step 2: `globals.css` structure**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
sed -n '1,60p' src/app/globals.css
grep -c '@tailwind ' src/app/globals.css
grep -n '@import "tailwindcss"\|@plugin\|@theme\|@source\|@layer base\|@custom-variant' src/app/globals.css
grep -n 'brand-cream\|brand-orange\|brand-teal\|brand-dark\|font-sans\|font-serif' src/app/globals.css
grep -n 'box-sizing\|help-pulse\|atlas-float\|bubble-pop\|pac-container' src/app/globals.css
grep -n 'border-color: var(--color-gray-200\|cursor: pointer\|@custom-variant hover' src/app/globals.css
grep -n "font-family: 'Inter'" src/app/globals.css
```
Expected:
- `@tailwind ` directive count: **0** (all three replaced).
- `@import "tailwindcss";` present at the top; `@plugin "@tailwindcss/typography";` present.
- `@theme` block containing `--color-brand-cream`, `--color-brand-cream-light`, `--color-brand-orange`, `--color-brand-teal`, `--color-brand-dark` (hexes `#F5F0EB`, `#FAF5EF`, `#EA580C`, `#0F766E`, `#111827`) and `--font-sans` / `--font-serif` referencing `var(--font-inter)` / `var(--font-playfair)`.
- All preserved blocks present: `box-sizing`, `help-pulse`, `atlas-float`, `bubble-pop`, `pac-container`.
- **REQUIRED — the v4-compat block must be present in full; insert whatever is missing** (review H-2/H-4/M-2 — unconditional, NOT gated on Task 9's eyeball: a cursor is invisible in screenshots, touch-hover is invisible to desktop Playwright). Three pieces, exact content in Task 2 Step 5(c):
  1. the v3 border-color `@layer base` rule (`*, ::after, ::before, ::backdrop, ::file-selector-button { border-color: var(--color-gray-200, currentColor) }`) — the codemod often inserts an equivalent; keep its version, do NOT duplicate;
  2. `button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer; }` in `@layer base` — the codemod does NOT insert this;
  3. top-level `@custom-variant hover (&:hover);` — the codemod does NOT insert this.
- **REQUIRED — the unlayered `body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }` rule must be GONE** (review M-3): the codemod preserves custom CSS, so on the codemod path delete it by hand here (the Task 2 Step 5(c) manual path already omits it). Rationale: v4 utilities live in `@layer utilities` and unlayered author CSS outranks ALL layers — the stale rule would newly beat the `font-sans` utility on `<body>` and bypass the tuned `Inter Fallback` chain. Note for the future: any unlayered `globals.css` rule now beats competing utilities; the remaining custom blocks (`.pac-*`, `.animate-*`, box-sizing) are fine — no utility competes with them (review-verified).
If any token/block is missing: add it exactly per the Task 2 Step 5(c) content (merging with whatever the codemod wrote, not duplicating).

- [ ] **Step 3: `tailwind.config.js` is gone**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ls tailwind.config.* 2>&1
grep -rn '@config' src/app/globals.css
```
Expected: `ls` errors (no config file); no `@config` directive. Spec success criterion 2 requires full CSS-first migration — a leftover JS config referenced via `@config` is NOT acceptable in this loop.
If the codemod kept the file + `@config`: move any remaining theme values into the `@theme` block per Step 2's expected token list, delete the `@config` line, and `git rm tailwind.config.js`.

- [ ] **Step 4: Rename inventory — post-codemod comparison**

Re-run the exact Task 1 Step 8 block, but tee to `rename-inventory-post.txt`:
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
{
  echo "outline-none        $(grep -rn 'outline-none' src/ | wc -l)"
  echo "outline-hidden      $(grep -rn 'outline-hidden' src/ | wc -l)"
  echo "flex-shrink-0       $(grep -rn 'flex-shrink-0' src/ | wc -l)"
  echo "shadow-sm           $(grep -rnP '(?<![\w-])shadow-sm(?![\w-])' src/ | wc -l)"
  echo "shadow-xs           $(grep -rnP '(?<![\w-])shadow-xs(?![\w-])' src/ | wc -l)"
  echo "bare-shadow         $(grep -rnP '(?<![\w-])shadow(?![\w-])' src/ --include='*.tsx' --include='*.ts' | wc -l)"
  echo "backdrop-blur-sm    $(grep -rn 'backdrop-blur-sm' src/ | wc -l)"
  echo "backdrop-blur-xs    $(grep -rn 'backdrop-blur-xs' src/ | wc -l)"
  echo "bare-backdrop-blur  $(grep -rnP '(?<![\w-])backdrop-blur(?![\w-])' src/ | wc -l)"
  echo "rounded-sm          $(grep -rnP '(?<![\w-])rounded-sm(?![\w-])' src/ | wc -l)"
  echo "rounded-xs          $(grep -rnP '(?<![\w-])rounded-xs(?![\w-])' src/ | wc -l)"
  echo "bare-rounded        $(grep -rnP '(?<![\w-])rounded(?![\w-])' src/ | wc -l)"
} | tee "$ART/rename-inventory-post.txt"
diff "$ART/rename-inventory-pre.txt" "$ART/rename-inventory-post.txt" || true
```
Expected post values (from the measured pre inventory): `outline-none 0` · `outline-hidden 64` · `flex-shrink-0 0` · `shadow-sm 1` (the renamed TripForm bare `shadow`) · `shadow-xs 43` · `bare-shadow 0` · `backdrop-blur-sm 3` (the renamed bare `backdrop-blur`s: `Header.tsx:69`, `app/not-found.tsx:15`, `[locale]/destinations/page.tsx:264` — review M-4) · `backdrop-blur-xs 8` · `bare-backdrop-blur 0` · `rounded-sm 54` · `rounded-xs 0` · `bare-rounded 0`.
**Known miss candidate:** if `bare-shadow` is still `1`, the codemod skipped the template literal at `src/components/TripForm.tsx:885`. Apply this exact edit — old string:
```
bg-white shadow transition-transform
```
new string:
```
bg-white shadow-sm transition-transform
```
For any OTHER non-zero v3 token: `grep -rnP '(?<![\w-])<token>(?![\w-])' src/` to locate it; if it is inside a `className`/template-literal, rename per the inventory table; if it is NOT a class (e.g. a JS `.blur()` call or a prose word in a comment), leave it and note it.

- [ ] **Step 5: Safety sweep — content and codemod warnings**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
grep -rlE 'outline-none|flex-shrink-0|blur-sm|shadow-sm' content/articles/ | head -5
grep -inE 'could not|warn|manual' /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/codemod.log | head -20
```
Expected: no `content/articles/` hits (article JSON is prose rendered via `prose`, not utility classes). If there ARE hits: do NOT edit generated content files — record the file list and surface it in the Task 11 STOP-gate message for Jose's call (content pipeline owns those files).
Every codemod warning line must now be accounted for: either fixed in Step 4 or explicitly noted as a non-class false positive.

- [ ] **Step 6: Commit fixes (only if Steps 1–4 made edits)**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git status --short
git add -u
git commit -m "fix(tpi): complete tailwind 4 codemod misses

<one line per fix, e.g.: rename bare 'shadow' in TripForm template literal (codemod skips dynamic contexts) / complete v4-compat block (button cursor + @custom-variant hover — codemod only inserts border-color) / delete unlayered body font-family rule (v4 layers would invert it over the font-sans utility)>

Co-Authored-By: Hermes GPT-5.5 <noreply@openai.com>"
```
If no edits were needed (possible only on the manual-fallback path, where Task 2 Step 5(c) already contains everything), skip.

---

## Task 5: Build fix-loop + O1 vendor-prefix verification

**Goal:** Land a clean `npm run build` on Tailwind v4, and answer spec open question **O1**: confirm removing `autoprefixer` dropped no prefix the accepted browser floor (Safari 16.4+/Chrome 111+/FF 128+) still needs.

**Files:** Indeterminate; most likely none. Possible fix targets: `src/app/globals.css` (directive/import errors), individual `src/**/*.tsx` (unknown-utility errors).

**Interfaces:**
- Consumes: Tasks 2–4 commits; `ART/baseline-prefixes.txt`.
- Produces: `ART/build-clean.log`, `ART/v4-prefixes.txt`, `ART/prefix-diff.txt`; fix commits only if the loop found errors.

- [ ] **Step 1: Run the build**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
npm run build 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/build-1.log
echo "exit=$?"
```
Expected (success case): exit 0 with a `Route (app)` table. If clean, skip Step 2 and go to Step 3.

- [ ] **Step 2: Conditional — diagnose and fix, one error at a time**

Diagnose the FIRST error in the log against this table, apply the minimal fix, re-run (incrementing the log number: `build-2.log`, …) until clean. If the same error recurs after a fix, the fix is wrong — revert it and rethink.

| Error pattern | Likely cause | Fix |
| --- | --- | --- |
| `Cannot apply unknown utility class` / `Unknown utility` naming a v3 token | A rename the codemod and Task 4 both missed | `grep -rn '<token>' src/` and rename per the inventory table. |
| Error pointing at `@tailwind base` or `tailwindcss/...` import | Stale v3 directive survived in `globals.css` | Re-apply Task 2 Step 5(c) header exactly. |
| `Missing "./..." specifier` / plugin resolution error on `@tailwindcss/typography` | Typography not v4-wired | Ensure `@plugin "@tailwindcss/typography";` sits directly under `@import "tailwindcss";` and the installed version is ≥0.5.10 (Task 3 Step 2 output). |
| PostCSS error naming `tailwindcss` as a plugin | Stale `postcss.config.*` | Re-apply Task 2 Step 5(b). |
| `@theme` parse error | Malformed token (e.g. unquoted comma-containing font stack the codemod mangled) | Re-check the `@theme` block against Task 4 Step 2's expected tokens. |
| Content/class not found at runtime pages (build passes but classes missing) | v4 auto-detection missed a source | Add `@source "../{dir}";` lines to `globals.css` — TPI's standard `src/` layout should NOT need this; investigate before adding. |

Commit any fixes:
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git add -u && git commit -m "fix(tpi): resolve tailwind 4 build errors

<one line per file changed>

Co-Authored-By: Hermes GPT-5.5 <noreply@openai.com>"
```

- [ ] **Step 3: Capture clean-build evidence**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
npm run build 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/build-clean.log | tail -20
echo "exit=$?"
```
Expected: exit 0, `Route (app)` table in the tail. Verification artifact.

- [ ] **Step 4: O1 — vendor-prefix comparison against the v3 baseline**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
find .next/static -name '*.css' -exec cat {} + | grep -oE '\-(webkit|moz|ms|o)-[a-z-]+' | sort -u | tee "$ART/v4-prefixes.txt"
diff "$ART/baseline-prefixes.txt" "$ART/v4-prefixes.txt" | tee "$ART/prefix-diff.txt" || true
find .next/static -name '*.css' -exec cat {} + | grep -c 'webkit-backdrop-filter'
find .next/static -name '*.css' -exec cat {} + | grep -c 'webkit-line-clamp'
```
(`find`, NOT `cat .next/static/css/*.css` — Next 16/Turbopack emits CSS under `.next/static/chunks/`; the same layout-agnostic form as Task 1 Step 5, so the diff compares like with like. Review B-1/H-1.)
**Hard gates** (TPI-specific — these utilities are in active use; both verified present in today's live v3 CSS):
- `-webkit-backdrop-filter` count ≥ 1 — Safari 16.4–17.x (inside the accepted floor) requires the prefix for TPI's 12 `backdrop-blur*` usages.
- `-webkit-line-clamp` count ≥ 1 — the prefixed property is the only implementation; TPI has 7 `line-clamp*` usages.

For every OTHER prefix present in `baseline-prefixes.txt` but absent from `v4-prefixes.txt` (the `<`-lines of the diff): confirm the unprefixed property is supported at Safari 16.4 / Chrome 111 / Firefox 128 (check caniuse via WebSearch if uncertain). A dropped prefix that the floor no longer needs is the EXPECTED outcome of removing autoprefixer — record it as verified-OK in the task report. A dropped prefix the floor still needs is an O1 failure: STOP and escalate (resolution would be a `@supports`/manual-prefix patch in `globals.css` — decide with the orchestrator, do not improvise).
Record the O1 verdict explicitly in the task report — Task 11's STOP-gate message quotes it.

---

## Task 6: Lint gate

**Goal:** `npm run lint` completes with **no new problems** versus the Task 1 baseline (Tailwind touches no lint surface — any delta is collateral from the class-rename diff, e.g. a mangled JSX string).

**Files:** None expected.

**Interfaces:**
- Consumes: `ART/baseline-lint.log`.
- Produces: `ART/lint-clean.log`.

- [ ] **Step 1: Run lint and compare to baseline**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
npm run lint 2>&1 | tee "$ART/lint-clean.log"
echo "exit=$?"
echo "--- baseline summary ---"; grep -E 'problem|warning|error' "$ART/baseline-lint.log" | tail -3
echo "--- current summary ---";  grep -E 'problem|warning|error' "$ART/lint-clean.log" | tail -3
```
Expected: the problem/warning/error summary counts are identical to baseline (both may be zero/empty — also identical). Exit code matches the baseline exit code.
If NEW problems appeared: every one will name a file the rename diff touched — read the line, fix the mangled string minimally, re-run, and commit as `fix(tpi): repair lint regression from tailwind 4 rename diff`. Do NOT fix pre-existing baseline warnings in this loop.

---

## Task 7: Unit-test gate (Vitest, 13 files)

**Goal:** `npm run test:unit` passes 13/13 test files — spec success criterion 5. The suite is style-agnostic (lib/logic tests), so any failure is collateral damage from the rename diff, not styling.

**Files:** None expected.

**Interfaces:**
- Consumes: Tasks 2–5 commits.
- Produces: `ART/unit-clean.log`.

- [ ] **Step 1: Run the unit suite**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
npm run test:unit 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/unit-clean.log | tail -12
echo "exit=$?"
```
Expected: exit 0; the summary shows `Test Files  13 passed (13)` — the same counts as `ART/baseline-unit.log`.
If FAIL: the failing file is one of the 13 `src/lib/**` tests — none imports Tailwind, so suspect a corrupted import/string in a file the rename diff touched. `git diff main -- <failing file's source>` to inspect; fix minimally; commit as `fix(tpi): repair unit regression from tailwind 4 rename diff`; re-run.

---

## Task 8: E2E behavioral gate (visual tests excluded)

**Goal:** All behavioral Playwright tests pass at the Task 1 baseline count. The 3 visual tests are EXCLUDED here — they are expected to fail against v3 snapshots and are Task 9's whole job.

**Files:** None expected; only touch a spec file if a behavioral test genuinely broke.

**Interfaces:**
- Consumes: `ART/baseline-e2e-counts.txt` (behavioral count = total passed − 3).
- Produces: `ART/e2e-behavioral.log`.

- [ ] **Step 1: Start the dev server and run the behavioral suite**

The visual tests are titled `planner/[tripId] at <width>w baseline screenshot` — `--grep-invert "baseline screenshot"` excludes exactly those 3.
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
sleep 2
npm run dev -- --port 3001 > "$ART/e2e-dev.log" 2>&1 &
echo $! > "$ART/dev-pid.txt"
sleep 15
curl -s -o /dev/null -w 'dev-up: %{http_code}\n' http://localhost:3001/
npx playwright test --grep-invert "baseline screenshot" 2>&1 | tee "$ART/e2e-behavioral.log" | tail -12
echo "e2e-exit=$?"
kill "$(cat "$ART/dev-pid.txt")" 2>/dev/null; sleep 1
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```
Expected: `dev-up: 200`; summary shows `passed` at the baseline behavioral count (baseline total from `ART/baseline-e2e-counts.txt` minus 3; ≈38). Zero failures.

- [ ] **Step 2: Conditional — diagnose failures**

| Failure pattern | Likely cause | Fix |
| --- | --- | --- |
| `Page closed` / browser crash / `connection refused` | Flaky run or slow dev warm-up | Re-run Step 1 once; bump `sleep 15` → `sleep 25` if the server was the problem. |
| Locator timeout on a class-based selector | A selector referencing a renamed class (sweep found none — but re-verify) | `grep -n '<selector>' tests/e2e/*` — update the selector to the v4 class name. |
| Element not visible / obscured | Real layout/visibility drift from the upgrade | This is a VISUAL regression escaping into behavior — treat as an upgrade bug: find the responsible class change (`git diff main -- <component>`), fix the component, NOT the test. |
| API assertion failures (`/api/trips`, auth, articles) | Not plausibly Tailwind | STOP — something else broke; compare with a re-run on `main` before touching anything. |

Fix minimally, re-run Step 1 (log to `e2e-behavioral-2.log`, …), repeat until the count matches baseline. Commit any changes as `fix(tpi)`/`test(tpi)` with a body explaining why the upgrade forced it.

---

## Task 9: Visual re-baseline + eyeball (the real work)

**Goal:** Regenerate the 3 visual baselines under v4, quantify the drift, and **eyeball old-vs-new** (planner snapshots + home/destinations/article full-page pairs — review H-2) for unintended shadow/blur/focus-ring/border/palette changes — this task answers spec open question **O2** and carries spec success criterion 4. The config swap was mechanical; THIS is where the upgrade is actually accepted or rejected.

**Eyeball protocol:** Hermes produces the artifacts and the numeric drift report. The **dispatching orchestrator (vision-capable) MUST Read the before/after/diff PNGs and the article screenshots** before accepting this task — a text-only pass is not an eyeball. Jose performs the final human eyeball at the Task 11 STOP-gate.

**Files:**
- Modify: `tests/e2e/visual-baseline.spec.ts-snapshots/planner-tripId-{1280,1440,1920}-chromium-linux.png` (regenerated)
- Possibly modify: `src/app/globals.css` (ONLY if Step 6-VERIFY finds the REQUIRED v4-compat block missing/malformed — the block ships unconditionally via Tasks 2/4; review H-2)

**Interfaces:**
- Consumes: green Tasks 5–8; `ART/baseline-article-v3.png`, `ART/baseline-home-v3.png`, `ART/baseline-destinations-v3.png`, `ART/article-slug.txt`.
- Produces: `ART/visual-drift.log`, `ART/visual-diffs/` (expected/actual/diff triplets), `ART/old-snapshots/` (v3 PNGs), `ART/article-v4.png`, `ART/home-v4.png`, `ART/destinations-v4.png`, `ART/e2e-full-clean.log`; commit with the 3 new snapshots.

- [ ] **Step 1: Start the dev server**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
sleep 2
npm run dev -- --port 3001 > "$ART/visual-dev.log" 2>&1 &
echo $! > "$ART/dev-pid.txt"
sleep 15
curl -s -o /dev/null -w 'dev-up: %{http_code}\n' http://localhost:3001/
```
Expected: `dev-up: 200`. Keep the server running through Step 7.

- [ ] **Step 2: Run the visual spec WITHOUT updating — capture the drift**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
npx playwright test tests/e2e/visual-baseline.spec.ts 2>&1 | tee "$ART/visual-drift.log" | tail -25
mkdir -p "$ART/visual-diffs"
find test-results -name '*.png' -exec cp {} "$ART/visual-diffs/" \;
ls "$ART/visual-diffs/"
```
Expected: **3 failed** — each failure line reports the pixel diff (e.g. `NNNN pixels (ratio 0.0X) are different`). Record the three ratios in the task report; they are the numeric drift measure. `visual-diffs/` now holds the `-expected` / `-actual` / `-diff` triplets.
If instead **3 passed**: v4 rendered pixel-identically (possible but unexpected). No re-baseline is needed — record that, skip Steps 3–4 and the fix loop, and go straight to Step 5's article/home/destinations comparison and Step 7's full suite.
If a test ERRORS (not a screenshot mismatch — e.g. the `/api/trips/` POST failed): that is a behavioral break escaping Task 8 — go back to Task 8's diagnosis table before proceeding.

- [ ] **Step 3: Preserve the v3 snapshots, then regenerate**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
mkdir -p "$ART/old-snapshots"
for w in 1280 1440 1920; do
  git show "main:tests/e2e/visual-baseline.spec.ts-snapshots/planner-tripId-${w}-chromium-linux.png" > "$ART/old-snapshots/planner-tripId-${w}.png"
done
ls -la "$ART/old-snapshots/"
npx playwright test tests/e2e/visual-baseline.spec.ts --update-snapshots 2>&1 | tail -8
git status --short tests/e2e/visual-baseline.spec.ts-snapshots/
```
Expected: 3 old PNGs saved; the update run writes the 3 snapshots; `git status` shows all three as modified.

- [ ] **Step 4: Determinism check — the new baselines must pass on a fresh run**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
npx playwright test tests/e2e/visual-baseline.spec.ts 2>&1 | tail -6
echo "exit=$?"
```
Expected: `3 passed`, exit 0. If flaky (a re-run diff against a snapshot generated seconds ago): the page has non-determinism that did NOT exist at pre-flight — investigate what the upgrade destabilized (an animation running during capture is the usual suspect; the 3 `@keyframes` animations must still be CSS-defined, check Task 4 Step 2) before accepting anything.

- [ ] **Step 5: Capture the v4 article/home/destinations screenshots (typography + O2 border/palette surfaces)**

The planner snapshots do not exercise `prose` styling — the article pair is the typography plugin's only visual evidence. The home + destinations pairs cover the O2 border/palette surfaces the planner snapshots never render (review H-2: the ~26 colorless-border elements live mostly in home/destinations-only components).
```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
SLUG=$(grep -oP '(?<=article-slug=).*' "$ART/article-slug.txt")
npx playwright screenshot --viewport-size=1280,900 --full-page "http://localhost:3001/$SLUG/" "$ART/article-v4.png"
npx playwright screenshot --viewport-size=1280,900 --full-page "http://localhost:3001/" "$ART/home-v4.png"
npx playwright screenshot --viewport-size=1280,900 --full-page "http://localhost:3001/destinations/" "$ART/destinations-v4.png"
ls -la "$ART/article-v4.png" "$ART/baseline-article-v3.png" \
       "$ART/home-v4.png" "$ART/baseline-home-v3.png" \
       "$ART/destinations-v4.png" "$ART/baseline-destinations-v3.png"
```
Expected: all six files exist, pairwise plausibly similar sizes.

- [ ] **Step 6: THE EYEBALL — orchestrator visually inspects, against this checklist**

The orchestrator (vision-capable) Reads, side by side: `ART/old-snapshots/planner-tripId-{1280,1440,1920}.png` vs `tests/e2e/visual-baseline.spec.ts-snapshots/planner-tripId-{1280,1440,1920}-chromium-linux.png`, the `ART/visual-diffs/*-diff.png` heat-maps, `ART/baseline-article-v3.png` vs `ART/article-v4.png`, `ART/baseline-home-v3.png` vs `ART/home-v4.png`, and `ART/baseline-destinations-v3.png` vs `ART/destinations-v4.png` (review H-2).

O2-driven checklist — for each item decide ACCEPT (imperceptible/intentional) or FIX:
1. **Borders (biggest risk):** card outlines, header `border-b`, input borders — check ESPECIALLY the home/destinations pairs (the ~26 colorless-border elements live mostly there; review H-2). v4 defaults border-color to `currentColor` — 213 bare `border*` usages — but the UNCONDITIONAL compat layer (Tasks 2/4) restores v3's `gray-200`. If borders turned dark/black anyway, go to Step 6-VERIFY below.
2. **Shadows:** card/modal/button shadow weight identical? (43 `shadow-xs` + 1 `shadow-sm` renames are value-preserving — visible change means a missed rename.)
3. **Backdrop blur:** modal overlays and sticky header blur radius identical? (8 `backdrop-blur-xs` + 3 `backdrop-blur-sm` — review M-4.)
4. **Focus/outline:** outline safety is proven by the Task 4 inventory reaching `outline-none = 0` / `outline-hidden = 64`, NOT by these captures — nothing is focused in a static screenshot, so "no outlines visible" is vacuous evidence (review N-2). Confirm the inventory numbers; optionally do one manual Tab-through in the dev server during the Task 11 STOP-gate review.
5. **Placeholder text:** input placeholder tint (v3 `gray-400` → v4 `currentColor/50` — slightly darker is the expected drift; ACCEPT unless jarring).
6. **Palette tint:** gray/orange/teal surfaces may shift imperceptibly (v4 oklch palette). ACCEPT hairline tint drift; FIX anything a user would notice.
7. **Layout:** zero geometry changes — spacing scale is untouched in v4; ANY element that moved means a rename or preflight regression. FIX.
8. **Article page (`prose`):** headings/paragraph rhythm/list markers match v3 capture (typography plugin re-wire).

**Step 6-VERIFY (the v4-compat block is UNCONDITIONAL — review H-2 — this step only verifies it, it does NOT decide whether to add it):** the block was inserted in Task 2 Step 5(c) and REQUIREd by Task 4 Step 2; confirm it survived to this commit:
```bash
grep -n 'border-color: var(--color-gray-200\|cursor: pointer\|@custom-variant hover' src/app/globals.css
```
Expected: all three pieces hit (border-color rule, button cursor rule, `@custom-variant hover`). If any piece is MISSING — a Task 4 verification escape; note it in the task report — insert the exact Task 2 Step 5(c) content into `src/app/globals.css` now. If checklist item 1 shows border drift WITH the block present, the block is malformed or overridden: diff it against Task 2 Step 5(c) and repair. After ANY fix: re-run Steps 2–5 from the top (fresh drift log, fresh regeneration, fresh eyeball) — the loop exits only when the orchestrator ACCEPTs every checklist item.

- [ ] **Step 7: Full E2E suite green + stop the server**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
npm run test:e2e 2>&1 | tee "$ART/e2e-full-clean.log" | tail -8
echo "exit=$?"
kill "$(cat "$ART/dev-pid.txt")" 2>/dev/null; sleep 1
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```
Expected: exit 0; `passed` at the Task 1 full-suite baseline count (≈41) — behavioral AND visual all green. Spec success criterion 5 satisfied locally.

- [ ] **Step 8: Commit the new baselines (+ any Step 6 fix)**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git add tests/e2e/visual-baseline.spec.ts-snapshots/ src/app/globals.css
git status --short
git commit -m "test(tpi): regenerate visual baselines for tailwind 4

Drift measured (pre-update run): <the 3 pixel ratios from visual-drift.log>.
Eyeballed old-vs-new at 1280/1440/1920 + home/destinations/article pages: <one
line verdict, e.g. 'hairline oklch tint drift only; borders/shadows/blur/focus
identical'>.
<If Step 6-VERIFY had to repair/insert the v4-compat block: note it — normally
it shipped in Tasks 2/4.>

Co-Authored-By: Hermes GPT-5.5 <noreply@openai.com>"
```
Expected: commit contains exactly the 3 PNGs (+ `globals.css` only if Step 6-VERIFY repaired it).
Edge case: if Step 2 passed 3/3 (pixel-identical rendering) and no fix was applied, nothing changed — skip the commit and record "v4 rendered pixel-identically; snapshots unchanged" in the task report.

---

## Task 10: Push the feature branch

**Goal:** Publish `chore/tailwind-4-upgrade` so the VPS can fetch it and Jose can inspect it.

**Interfaces:**
- Consumes: all local gates green (Tasks 5–9).
- Produces: `origin/chore/tailwind-4-upgrade`; `ART/push.log`.

- [ ] **Step 1: Verify branch state**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git log --oneline main..HEAD
git status --short
```
Expected: 2+ commits ahead of `main` (codemod commit, snapshot commit, plus any conditional dep/fix commits). Working tree clean except (possibly) unrelated untracked banked docs from other loops (the exact set varies — review M-1; never commit them in this plan).

- [ ] **Step 2: Push**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git push -u origin chore/tailwind-4-upgrade 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/push.log
```
Expected: branch pushed; GitHub URL in the log.

---

## Task 11: STOP-gate — Jose's visual review + prod go-ahead (HARD GATE)

**Goal:** Present the complete local evidence — above all the before/after visuals — and BLOCK until Jose explicitly approves the VPS deploy. Per `feedback_no_deploy_without_review`, nothing after this line runs without his textual go-ahead.

**Interfaces:**
- Consumes: every `ART/` artifact from Tasks 1–10.
- Produces: Jose's recorded decision.

- [ ] **Step 1: Open the review set in VS Code** (per `feedback_open_review_files_in_vscode`)

```bash
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
code /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype/docs/superpowers/specs/2026-07-07-tailwind-4-upgrade-design.md
code /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype/docs/superpowers/plans/2026-07-07-tailwind-4-upgrade.md
for w in 1280 1440 1920; do
  code "$ART/old-snapshots/planner-tripId-${w}.png"
  code "/home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype/tests/e2e/visual-baseline.spec.ts-snapshots/planner-tripId-${w}-chromium-linux.png"
done
code "$ART/baseline-article-v3.png"
code "$ART/article-v4.png"
code "$ART/baseline-home-v3.png"
code "$ART/home-v4.png"
code "$ART/baseline-destinations-v3.png"
code "$ART/destinations-v4.png"
ls "$ART/visual-diffs/" && code "$ART/visual-diffs"
```

- [ ] **Step 2: STOP — present the summary and wait for explicit approval**

Print this message (filling every `<...>` from the artifacts) and block until Jose replies affirmatively:
```
TPI Tailwind 3 -> 4 upgrade — local verification complete on chore/tailwind-4-upgrade:
- npm run build: clean (Route table, exit 0)
- O1 autoprefixer removal: <verdict from Task 5 Step 4 — e.g. "-webkit-backdrop-filter and -webkit-line-clamp present; no floor-required prefix dropped">
- npm run lint: no new problems vs baseline (<counts>)
- npm run test:unit: 13/13 test files passed
- npm run test:e2e: <N> passed (matches pre-upgrade baseline), incl. 3 regenerated visual baselines
- Visual drift measured: <3 pixel ratios>; eyeball verdict: <one line from Task 9 Step 6>
  -> old vs new snapshots + home/destinations/article before/after now open in VS Code for your review
- v4-compat block ships unconditionally in globals.css: v3 default border-color, button
  cursor:pointer restored (v4 preflight dropped it — 161 buttons, only 27 explicit
  cursor-pointer), and @custom-variant hover restoring v3 hover-on-touch — without it the
  hover-revealed info tooltip at TripForm.tsx:415-419 would be unreachable on touch devices.
- <If Task 4 Step 5 found content/articles hits, list them here for your call>

DEPLOY-SCOPE WARNING: the VPS is currently at <preflight-vps-sha short>. Deploying this
branch also deploys every main commit since then (see list below) — as of plan-writing
that includes the UNDEPLOYED Atlas Phase 2 brain relocation, which is awaiting VPS
secrets and will run behind its Phase 0 health-gate (Atlas degrades gracefully) until
the secrets land:
<contents of preflight-vps-drift.txt>

Next is the VPS deploy to root@104.225.221.138 (PM2 process tpi). It will:
  1. Stop tpi-schedule-runner.timer
  2. Fetch + checkout chore/tailwind-4-upgrade, npm install, rm -rf .next, npx next build, pm2 reload tpi
     (split SSH commands — guard_vps_deploy.py hook workaround, used only under this approval)
  3. Run the 9-URL smoke + 2 Phase-2 probes (/api/assistant/health, /planner/ — the first
     prod exercise of the Phase-2 rider; expect degraded-but-alive, not 5xx) + confirm the
     live CSS is Tailwind v4 via minification-proof markers (@layer/oklch — the v4 banner
     comment is stripped by the prod minifier)
  4. Resume tpi-schedule-runner.timer

Approve the VPS deploy, including the Phase-2 rider? (Reply "go" / "deploy" / "yes" or equivalent.)
```
Do NOT proceed to Task 12 without explicit textual approval. If Jose rejects the visuals: loop back to Task 9 with his feedback. If he wants the Phase-2 secrets handled first: park here — that work is out of this plan's scope.

---

## Task 12: VPS deploy (split SSH commands)

**Goal:** Deploy the branch to the VPS with the schedule timer paused and the mandatory `rm -rf .next` guard.

**Pre-req:** Jose's explicit go-ahead from Task 11 Step 2. Confirm it is on the record before running anything here.

**Why these exact command shapes:** the PreToolUse hook `/home/jarvis/.claude/hooks/guard_vps_deploy.py` denies any single Bash command matching `ssh.*104\.225\.221\.138.*(npm run build|pm2 restart|git pull.*&&)`. It is a blunt regex that would block even this approved deploy if the commands were combined. The documented workaround (MEMORY, proven on the Phase-0/Phase-2 deploys): **one SSH invocation per step**, `npx next build` instead of `npm run build`, `pm2 reload` instead of `pm2 restart`, and never `&&` after `git pull`. `scripts/deploy-vps.sh` is NOT executed verbatim: it has no `git pull`, no `rm -rf .next` guard (the `ENOENT: .next/build-manifest.json` race from the Next-16 loop, spec §3.9 there), and hard-requires a local `.env` check we cannot pre-verify from here. `command-post/deploy_tpi.sh` is a content-slug publisher — wrong tool.

**Interfaces:**
- Consumes: `origin/chore/tailwind-4-upgrade`; `ART/preflight-vps-sha.txt` (rollback anchor).
- Produces: `ART/vps-deploy-{1..5}.log`, `ART/vps-pm2.txt`.

- [ ] **Step 1: Pause the schedule-runner timer**

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "systemctl stop tpi-schedule-runner.timer" 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-deploy-1.log
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "systemctl is-active tpi-schedule-runner.timer || echo timer-stopped"
```
Expected: `inactive` / `timer-stopped`. Prevents a scheduled publish racing the rebuild.

- [ ] **Step 2: Fetch + checkout the branch, then pull (each its own SSH call)**

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git fetch origin && git checkout chore/tailwind-4-upgrade" 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-deploy-2.log
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git pull --ff-only origin chore/tailwind-4-upgrade" 2>&1 | tee -a /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-deploy-2.log
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git rev-parse HEAD"
```
Expected: checkout + fast-forward succeed; the final SHA equals the local branch HEAD (`git rev-parse chore/tailwind-4-upgrade` locally). Note: `git pull` is the LAST token of its command — no `&&` follows it (hook-safe).

- [ ] **Step 3: Install dependencies**

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && npm install" 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-deploy-3.log
echo "exit=$?"
```
Expected: exit 0. The VPS runs Node 20.x vs the local Node 22 lockfile — the Next-16 loop survived this, but `@tailwindcss/postcss` ships a native (oxide) binary: if install fails on an engine/native-module error, STOP — the previous build is still live and `.next` is intact, but the disk is now INCONSISTENT (feature-branch checkout + half-upgraded `node_modules`) while PM2 serves from memory, so a crash/restart before resolution would be an outage. Capture the error, then restore consistent disk state BEFORE escalating: run Task 15 Step 1's checkout-`$PREV_SHA` + `npm install` legs only (skip the rebuild/reload — `.next` is intact and PM2 still serves the old build; review L-1). Then escalate to Jose. Do NOT proceed past a failed install.

- [ ] **Step 4: Clean `.next` and build (hook-safe `npx next build`)**

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && rm -rf .next" 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-deploy-4.log
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && npx next build" 2>&1 | tee -a /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-deploy-4.log
echo "build-exit=$?"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "ls /home/travelplaninfo/nextjs/.next >/dev/null 2>&1 && echo .next-exists || echo .next-DELETED"
```
Expected: `build-exit=0` with the `Route (app)` table; `.next-exists`.
**STOP conditions:**
- `build-exit` non-zero and `.next-DELETED` → **critical**: the old artifact is gone and no new one exists; PM2 still serves from memory but cannot survive a restart. Go to Task 15 IMMEDIATELY.
- `build-exit` non-zero, error names a Tailwind/PostCSS module → the VPS install diverged from local; go to Task 15, then debug the install offline.

- [ ] **Step 5: Reload PM2 (hook-safe `pm2 reload`) and verify**

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && pm2 reload tpi" 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-deploy-5.log
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "pm2 list" 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-pm2.txt
```
Expected: `tpi` row shows `online` (not `errored`/`stopped`).
If `errored`: `ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "pm2 logs tpi --lines 50 --nostream"`, capture, then Task 15.

---

## Task 13: VPS smoke (9 URLs + Phase-2 probes) + v4-CSS live assertion + resume timer

**Goal:** Confirm all 9 critical URLs return 200 on live travelplaninfo.com, probe the two Phase-2 surfaces this deploy ships to prod for the first time (review H-3), prove the served CSS is actually Tailwind v4 via minification-proof markers (review B-1), then resume the schedule timer. Spec success criterion 6.

**Interfaces:**
- Consumes: Task 12 complete.
- Produces: `ART/vps-smoke.log`, `ART/vps-css-check.txt` + `ART/live.css`, `ART/vps-timer-resume.txt`; final artifact roundup.

- [ ] **Step 1: 9-URL smoke + Phase-2 probes**

```bash
for url in / /es/ /pt/ /fr/ /de/ /it/ /sitemap.xml /robots.txt /destinations/; do
  echo -n "$url: "
  curl -s -o /dev/null -w "%{http_code}" "https://travelplaninfo.com$url"
  echo
done | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-smoke.log
{
  echo -n "/api/assistant/health: "; curl -s -o /dev/null -w "%{http_code}" https://travelplaninfo.com/api/assistant/health; echo
  echo -n "/planner/: ";             curl -s -o /dev/null -w "%{http_code}" https://travelplaninfo.com/planner/; echo
} | tee -a /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-smoke.log
curl -s https://travelplaninfo.com/api/assistant/health | head -c 300; echo
```
Expected: the 9 core URLs every status `200` (`/` = unprefixed English; `/es/ /pt/ /fr/ /de/ /it/` = the 5 prefixed locales; sitemap + robots = metadata routes; `/destinations/` = content page). Then the 2 Phase-2 probes — this deploy is the first prod exposure of the Atlas Phase 2 brain, and the 9 core URLs exercise ZERO Phase-2 code (review H-3): `/api/assistant/health` returns **200 with the Phase-0 health-gate's degraded-but-alive payload** (VPS secrets may still be missing — a degraded payload is EXPECTED and fine; 5xx is not), and `/planner/` returns 200.
If any core URL is non-200, or either Phase-2 probe returns 5xx: do NOT resume the timer — go to Task 15.

- [ ] **Step 2: Live v4-CSS assertion (minification-proof markers)**

A 200 can still serve a broken stylesheet; assert the live CSS is the v4 artifact. Two traps this step is built around (review B-1, both verified against live prod 2026-07-07): Next 16/Turbopack serves CSS under `/_next/static/chunks/`, NOT `static/css/`; and the `/*! tailwindcss vX ... */` banner does NOT survive the production minifier (the live v3 chunk contains zero `tailwindcss v` matches) — so a healthy v4 deploy will never show the banner either. Assert v4 via markers that survive minification:
```bash
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
CSSPATH=$(curl -s https://travelplaninfo.com/ | grep -oE '/_next/static/(chunks|css)/[^"]+\.css' | head -1)
echo "css=$CSSPATH" | tee "$ART/vps-css-check.txt"
[ -n "$CSSPATH" ] || echo "NO-STYLESHEET-LINK"
curl -s "https://travelplaninfo.com$CSSPATH" -o "$ART/live.css"
{
  echo "layer-count=$(grep -c '@layer' "$ART/live.css")"
  echo "oklch-count=$(grep -c 'oklch(' "$ART/live.css")"
  echo "webkit-backdrop-filter-count=$(grep -c 'webkit-backdrop-filter' "$ART/live.css")"
} | tee -a "$ART/vps-css-check.txt"
```
Expected: `layer-count` ≥ 1 AND `oklch-count` ≥ 1 — minification-proof v4 discriminators (both measure **0** in today's live v3 CSS; v3 emits neither). `webkit-backdrop-filter-count` ≥ 1 (O1 holding in prod). Do NOT grep for a `tailwindcss v4` banner — its absence is normal in minified prod CSS and treating it as failure would false-fail into a production rollback (review B-1).
If `NO-STYLESHEET-LINK` printed: STOP and inspect the homepage HTML by hand before concluding anything — an empty `CSSPATH` makes the `curl` silently re-fetch the homepage HTML, so the marker counts would be meaningless; this alone is NOT a rollback trigger.
If the CSS fetch 404s, or the markers read v3 (`layer-count`=0 / `oklch-count`=0): the build served a stale artifact — go to Task 15.

- [ ] **Step 3: Resume the schedule-runner timer**

Only after Steps 1–2 pass:
```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "systemctl start tpi-schedule-runner.timer && systemctl status tpi-schedule-runner.timer --no-pager" 2>&1 | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-timer-resume.txt
```
Expected: `Active: active (waiting)` — matches the pre-flight state. If it fails to resume: rollback trigger — Task 15.

- [ ] **Step 4: Final verification-artifact roundup**

```bash
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
echo "=== local build ===";      tail -12 "$ART/build-clean.log"
echo "=== O1 prefix diff ===";   cat "$ART/prefix-diff.txt"
echo "=== lint ===";             tail -3 "$ART/lint-clean.log"
echo "=== unit ===";             tail -4 "$ART/unit-clean.log"
echo "=== full e2e ===";         tail -4 "$ART/e2e-full-clean.log"
echo "=== visual drift ===";     grep -E 'pixels|ratio|failed|passed' "$ART/visual-drift.log" | tail -6
echo "=== vps pm2 ===";          cat "$ART/vps-pm2.txt"
echo "=== vps smoke ===";        cat "$ART/vps-smoke.log"
echo "=== vps css v4 ===";       cat "$ART/vps-css-check.txt"
echo "=== vps timer ===";        tail -5 "$ART/vps-timer-resume.txt"
```
Expected: every block backs its success claim with fresh output — satisfies `superpowers:verification-before-completion`. Report this roundup to Jose.

---

## Task 14: Merge + branch cleanup (on Jose's instruction only)

**Goal:** Land the branch on `main`, point the VPS back at `main`, and clean up — only when Jose says merge (he may prefer a PR; both paths below).

**Pre-req:** Task 13 fully green AND Jose's explicit merge instruction. Ask: "Smoke is green. Merge `chore/tailwind-4-upgrade` to `main` directly, open a PR, or leave it for later?"

- [ ] **Step 1a: Direct merge path**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git checkout main
git merge --no-ff chore/tailwind-4-upgrade -m "Merge chore/tailwind-4-upgrade: Tailwind CSS 3.4.19 -> 4.x (Loop #2)

CSS-first config (@theme), @tailwindcss/postcss, autoprefixer removed,
~174 utility renames, 3 visual baselines regenerated + eyeballed.
Deployed to VPS and smoke-verified before merge.

Co-Authored-By: Hermes GPT-5.5 <noreply@openai.com>"
git push origin main
```
Expected: merge commit on `main`, pushed.

- [ ] **Step 1b: PR path (alternative, if Jose prefers)**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
gh pr create --base main --head chore/tailwind-4-upgrade \
  --title "chore(tpi): Tailwind CSS 3.4.19 -> 4.x upgrade (Loop #2)" \
  --body "CSS-first config (@theme), @tailwindcss/postcss, autoprefixer removed, ~174 utility renames, 3 visual baselines regenerated + eyeballed. Already deployed to VPS and smoke-verified (9/9 x 200 + Phase-2 probes alive; live CSS asserts v4 via @layer/oklch markers)."
```
Then stop — Jose merges the PR himself. Resume at Step 2 after the merge.

- [ ] **Step 2: Point the VPS at `main`**

The VPS is on the feature branch; after the merge the trees are identical, so no rebuild is needed — just move the ref (split SSH, hook-safe):
```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git fetch origin && git checkout main"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git pull --ff-only origin main"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git status --short && git log --oneline -1"
```
Expected: VPS on `main` at the merge commit, clean tree. `pm2 list` untouched (no reload needed — same content).
Sanity: re-run the Task 13 Step 1 smoke once (all 9 × 200) to confirm nothing moved.

- [ ] **Step 3: Delete the branch**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
git branch -d chore/tailwind-4-upgrade
git push origin --delete chore/tailwind-4-upgrade
```
Expected: local and remote branch removed. Keep the `ART/` directory until the next session-end routine (it is the evidence trail).

---

## Task 15: Rollback (conditional — only if Task 12/13 fails)

**Goal:** Restore the previous live build. Trigger rule (mirrors the Next-16 loop): roll back immediately if, within 10 minutes of deploy, any smoke URL is non-200, the live CSS check fails, PM2 shows `errored`, `.next` is deleted without a completed build, or the timer fails to resume.

**Local-only failure note:** if the failure happened BEFORE Task 12 (any local gate), there is nothing to roll back — the branch simply isn't merged/deployed; `main` and the VPS are untouched. Per spec §6, reverting the branch fully restores v3 (`package.json` + `postcss.config.js` + `tailwind.config.js` + `globals.css` + the rename diff all live only on the branch).

- [ ] **Step 1: Roll the VPS back to the pre-upgrade commit (split SSH, hook-safe)**

The anchor is `ART/preflight-vps-sha.txt` from Task 1 Step 4.
```bash
ART=/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts
PREV_SHA=$(cat "$ART/preflight-vps-sha.txt")
echo "Rolling back VPS to $PREV_SHA"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git checkout $PREV_SHA" 2>&1 | tee "$ART/vps-rollback.log"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && npm install" 2>&1 | tee -a "$ART/vps-rollback.log"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && rm -rf .next" 2>&1 | tee -a "$ART/vps-rollback.log"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && npx next build" 2>&1 | tee -a "$ART/vps-rollback.log"
echo "rollback-build-exit=$?"
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && pm2 reload tpi" 2>&1 | tee -a "$ART/vps-rollback.log"
```
Expected: checkout + install + build succeed (`Route (app)` table), `pm2 reload` completes. `npm install` here matters — the rollback commit's lockfile still expects tailwind v3 + autoprefixer.
**If the rollback build itself fails:** do NOT touch pm2 — it still serves the previous build from memory and is the last line of defense; skip the reload, capture everything, and escalate to Jose immediately (review L-1).

- [ ] **Step 2: Verify the rollback**

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "pm2 list"
for url in / /es/ /pt/ /fr/ /de/ /it/ /sitemap.xml /robots.txt /destinations/; do
  echo -n "$url: "
  curl -s -o /dev/null -w "%{http_code}" "https://travelplaninfo.com$url"
  echo
done | tee /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-rollback-smoke.log
{
  echo -n "/api/assistant/health: "; curl -s -o /dev/null -w "%{http_code}" https://travelplaninfo.com/api/assistant/health; echo
  echo -n "/planner/: ";             curl -s -o /dev/null -w "%{http_code}" https://travelplaninfo.com/planner/; echo
} | tee -a /home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/vps-rollback-smoke.log
```
Expected: `tpi` `online`; all 9 URLs `200`; `/api/assistant/health` + `/planner/` non-5xx (review H-3 — the rollback target predates Phase 2 but carries the Phase-0 health-gate, deployed 2026-07-05, so both routes exist).

- [ ] **Step 3: Resume the timer + report**

```bash
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "systemctl start tpi-schedule-runner.timer && systemctl status tpi-schedule-runner.timer --no-pager"
```
Expected: `active (waiting)` — environment restored to pre-flight state.
Report to Jose: what failed, the captured logs, and that live is back on the pre-upgrade build. Do NOT delete `chore/tailwind-4-upgrade` — it is the fix-forward base. Note: the VPS is now DETACHED at `PREV_SHA`; during fix-forward, re-point it at a branch/`main` promptly rather than leaving it detached indefinitely (review L-1).

---

## Verification artifacts (collected during the plan)

All under `/home/jarvis/.openclaw/workspace/jarvis-project/state/tw4-artifacts/` (reboot-safe — this loop may span days across the STOP-gate):

- `preflight-local-sha.txt` / `preflight-vps-sha.txt` — rollback anchors
- `preflight-vps-drift.txt` — undeployed-main-commits disclosure for the STOP-gate
- `preflight-pm2.txt` / `preflight-timer.txt` — pre-flight VPS state
- `baseline-build.log` / `baseline-lint.log` / `baseline-unit.log` / `baseline-e2e.log` + `baseline-e2e-counts.txt` — v3 green baseline
- `baseline-prefixes.txt` / `v4-prefixes.txt` / `prefix-diff.txt` — O1 evidence
- `rename-inventory-pre.txt` / `rename-inventory-post.txt` — 174-rename accounting
- `codemod.log` — upgrade-tool output + warnings
- `npm-install.log` / `resolved-versions.txt` — dependency end-state proof
- `build-clean.log` / `lint-clean.log` / `unit-clean.log` / `e2e-behavioral.log` / `e2e-full-clean.log` — post-upgrade gates
- `visual-drift.log` / `visual-diffs/` / `old-snapshots/` / `baseline-{article,home,destinations}-v3.png` / `{article,home,destinations}-v4.png` — O2 eyeball evidence (home/destinations pairs per review H-2)
- `push.log` / `vps-deploy-{1..5}.log` / `vps-pm2.txt` / `vps-smoke.log` (incl. Phase-2 probes) / `vps-css-check.txt` + `live.css` — deploy evidence
- `vps-rollback.log` / `vps-rollback-smoke.log` — only if Task 15 ran

---

## Memory references

- `[[feedback_stay_on_latest_stack]]` — drives the upgrade now
- `[[feedback_no_deploy_without_review]]` — gates Task 11 (hard STOP before Task 12)
- `[[feedback_verification_loop_runbook]]` — artifact set above; fresh output for every claim
- `[[feedback_open_review_files_in_vscode]]` — Task 11 Step 1
- `[[feedback_model_routing_fable_gpt55]]` — Hermes GPT-5.5 implements; Opus orchestrates + eyeballs; Fable reviews
- `[[feedback_update_help_with_features]]` — N/A (no user-facing feature change)
- MEMORY "TPI Deployment" + `guard_vps_deploy.py` workaround — Task 12 command shapes
- Backlog "TPI stack-currency follow-on loops" — TS 6 / ESLint 10 / `@types/node` 24 stay deferred

---

## Plan-author notes

Candid gaps, risks, and decisions made while writing this plan (input for the adversarial review):

1. **Spec §3's "scale shift — changes rendering" is imprecise, and I planned around the correct mechanics.** The v4 renames (`shadow-sm`→`shadow-xs` etc.) are *value-preserving when applied* — a fully-applied codemod produces pixel-identical shadow/blur output. The real rendering risks are (a) any occurrence the codemod misses (now rendering at the v4 meaning of the old name — hence the exact-count rename inventory in Tasks 1/4), and (b) the preflight/palette changes the spec files under O2 (border-color→`currentColor` with **213 bare `border*` usages** — the single biggest drift risk, which the spec never quantifies — plus placeholder color and oklch palette). The mandatory visual re-baseline stands either way; I added the pre-written border-compat fix so a failed eyeball has a one-step remedy.
2. **Fresh-sweep refinements beyond spec §3:** 54 bare `rounded` → `rounded-sm` renames the spec didn't list (value-preserving, codemod-handled); the 8 "blur-sm" occurrences are all `backdrop-blur-sm` plus 4 bare `backdrop-blur` *[review M-4 corrected this to 3, in 3 files — the inventory table above is authoritative]*; the 1 bare `shadow` sits in a template literal (`TripForm.tsx:885`) — flagged as the likely codemod miss with a pre-written fix. The spec's brand-color tokens are migrated per spec, but note: **zero `brand-*` class usages exist in `src/`** — the palette is currently dead config; migrating it is harmless and spec-mandated, but a follow-up cleanup candidate.
3. **Deploy-scope side effect the spec ignores:** the VPS is (as of writing) behind `main` — deploying this branch also deploys the un-deployed Atlas Phase 2 merge, which is still waiting on VPS secrets (health-gate protects it, but Jose must consciously accept this). I made Task 1 measure the drift and Task 11 disclose it verbatim in the STOP-gate message rather than resolving it inside this plan.
4. **Codemod TTY behavior is unverified.** The Next-16 loop's `@next/codemod` hung in non-TTY; `@tailwindcss/upgrade` is generally non-interactive, but I could not test it without running it (out of scope for a plan author). Task 2 carries a `script -qec` TTY-emulation fallback and a complete manual-migration fallback (exact file contents + order-sensitive perl renames, with the bare-`shadow`/`blur` false-positive traps called out).
5. **"Eyeball" delegation decision:** Hermes (the implementer) may not be vision-capable, so Task 9 explicitly assigns the visual inspection to the vision-capable orchestrator (with a concrete 8-item checklist) and to Jose at the STOP-gate; Hermes only produces artifacts and numeric drift ratios. If the review disagrees, the alternative is a dedicated vision-capable subagent dispatch for Task 9 Step 6.
6. **Deviation from the template's `/tmp` artifact convention:** this is a *banked* plan (execution deferred) on a workstation that sleeps/reboots, and the rollback anchor SHA must survive until deploy day — artifacts live in `state/tw4-artifacts/` instead. If the reviewer prefers template fidelity, only the two SHA anchors strictly need persistent storage.
7. **O1 verification is inventory-diff-based, not exhaustive:** comparing emitted `-webkit-*`/`-moz-*` prefixes v3-vs-v4 plus two hard gates (`-webkit-backdrop-filter`, `-webkit-line-clamp`) covers TPI's actual utility usage; it does not prove Lightning CSS's general equivalence to autoprefixer (nothing short of a browser matrix would). Given the accepted floor, I judged this proportionate.
8. **Visual snapshots run against the dev server** (matching how the existing baselines were generated — `playwright.config.ts` has no `webServer`, `baseURL` :3001). Dev-vs-prod CSS differences under Tailwind are minimal but nonzero; the Task 13 live-CSS assertion (v4 banner + prefix grep on the served stylesheet) partially closes that gap. A prod-build visual pass was omitted to keep parity with the existing baseline harness.
9. **Version pins:** "4.3.2"/"0.5.20" are plan-time latest (`npm view`, 2026-07-07); tasks instruct `^4.x`/latest-0.5.x resolution at execution time, so staleness at un-banking time is handled.
10. **`prose`/typography visual coverage was invented by me** (the article-page screenshot pair) — the 3 planner snapshots never exercise the typography plugin, so spec criterion 2's `@plugin` re-wire had no visual gate at all without it. It is a manual-eyeball artifact only, not an automated assertion.
