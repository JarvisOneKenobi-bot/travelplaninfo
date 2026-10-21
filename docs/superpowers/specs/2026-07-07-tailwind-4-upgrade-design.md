# TPI Tailwind 3 → 4 Upgrade (Design) — Loop #2

**Date:** 2026-07-07
**Status:** Design approved (Jose, 2026-07-07, remote — browser-floor bump accepted). Implementation deferred — *banked* spec/plan pair.
**Revised 2026-07-07:** §1/§3/§4/§5/§6/§7 corrected per the adversarial plan review (`docs/superpowers/reviews/2026-07-07-tailwind-4-upgrade-plan-review.md` — B-1, H-2, H-3, H-4, M-2, M-3, M-4, M-5).
**Repo:** `travelplaninfo-prototype` (`main` @ `4d5a1e7`)
**Driver:** `feedback_stay_on_latest_stack`. Second of the TPI stack-currency loops (Loop #1B = Next 16, done). Template = TPI's own `2026-05-21-next-16-upgrade` loop (VPS-shaped).

---

## 1. Goal & success criteria

Move TPI from `tailwindcss 3.4.19` to **v4.x** with CSS-first config and **zero visual regression**.

**Success criteria:**
1. Build succeeds on Tailwind v4 (`@tailwindcss/postcss` in PostCSS, `@import "tailwindcss"` in CSS).
2. JS `tailwind.config.js` migrated to a CSS-first `@theme` block (5 brand colors + 2 font stacks); `@tailwindcss/typography` re-wired via `@plugin`.
3. All v4 class renames applied (see §3).
4. The 3 Playwright visual baselines regenerated **and manually eyeballed**, plus before/after full-page pairs for `/`, `/destinations/`, and one article page (review H-2) — no unintended border/palette/shadow/blur/focus-ring drift.
5. `npm run lint` (no new errors), `npm run test:unit` (13/13), `npm run test:e2e` (behavioral) green; `npm run build` clean.
6. VPS deploy live; 9-URL smoke all 200 + 2 Phase-2 probes (`/api/assistant/health`, `/planner/`) non-5xx (review H-3); live CSS asserts v4 via minification-proof markers (`@layer`/`oklch(` — the banner comment does not survive the prod minifier; review B-1).

---

## 2. Approach

**Recommended:** official codemod `npx @tailwindcss/upgrade` followed by a build→lint→test→visual fix-and-verify loop. The codemod transforms the JS config → `@theme`, `@tailwind` directives → `@import "tailwindcss"`, the PostCSS plugin chain, the typography plugin wiring, and the class renames automatically. Given TPI's config is clean (no `@apply`/`@layer`/`theme()`, one CSS file), the codemod does ~all of the structural work.

*Rejected:* hand-migration (error-prone, no benefit given how clean the config is); staying on v3 (against `feedback_stay_on_latest_stack`; v3 is effectively EOL).

---

## 3. Known breakage surface (measured 2026-07-07 sweep)

**Structural risk: LOW.** Zero `@apply`/`@layer`/`theme()`/`@config`/`@variants`/`@responsive` anywhere; a single CSS file (`src/app/globals.css`); plain JS config (5 brand colors `cream`/`cream-light`/`orange`/`teal`/`dark`, 2 font stacks `var(--font-inter)`/`var(--font-playfair)`, typography plugin only); ~32 arbitrary-value classes (supported in v4, no change).

**Renamed/removed utilities (codemod auto-applies) — corrected per review M-4/M-5:**
| Change | Count | Notes |
|---|---|---|
| `flex-shrink-0` → `shrink-0` | 1 | `ActivityCard.tsx:52` |
| opacity utilities (`bg-opacity-*` etc.) | 0 | the classic painful rename — absent |
| `shadow-sm` → `shadow-xs` | 43 (27 files) | v4 `--shadow-xs` = v3 `shadow-sm` value — **value-preserving when applied** |
| bare `shadow` → `shadow-sm` | 1 | `TripForm.tsx:885`, template literal — likely codemod miss; plan has the manual fix |
| bare `rounded` → `rounded-sm` | 54 | v4 `--radius-sm` (0.25rem) = v3 bare `rounded` value — was missing from this spec (review M-5) |
| `backdrop-blur-sm` → `backdrop-blur-xs` | 8 (8 files) | all 8 "blur" hits are `backdrop-blur-sm`; standalone `blur-sm` = 0 (this row previously mislabeled — review M-5) |
| bare `backdrop-blur` → `backdrop-blur-sm` | 3 (3 files) | `Header.tsx:69`, `app/not-found.tsx:15`, `[locale]/destinations/page.tsx:264` (review M-4) |
| `outline-none` → `outline-hidden` | 64 (14 files) | the APPLIED rename preserves v3 behavior (`outline-hidden` = old transparent-outline trick); a MISSED `outline-none` changes focus-ring rendering, because v4 re-means `outline-none` as `outline-style: none` |

**Corrected mechanics (review M-5 — supersedes this section's original "scale shift — changes rendering" claims):** the renames are **value-preserving when applied** — a fully-applied codemod produces identical shadow/blur/radius output (verified against the v4 theme: v4 `--shadow-xs` = v3 `shadow-sm`, v4 `--shadow-sm` = v3 bare `shadow`, v4 `--radius-sm` = v3 bare `rounded`, v4 `--blur-xs` = v3 `blur-sm`). Stronger still, v4 ships a deprecated theme block (`--shadow`, `--blur`, `--radius` at exact v3 values), so even a **missed bare** token renders identically; only a missed `*-sm` token or a missed `outline-none` actually changes rendering. The plan's exact-count rename inventory (Tasks 1/4) closes that hole.

**The real rendering risk is v4 preflight/palette drift, independent of the renames (O2):**
- default border-color `gray-200` → `currentColor` — **213 bare `border*` usages in TPI; ~26 border-carrying elements have no color utility on the element**, mostly in home/destinations-only components — the single biggest drift exposure (previously unquantified here — review M-5); neutralized by the plan's **unconditional** `@layer base` border-color compat block (review H-2);
- preflight drops `button { cursor: pointer }` — 161 `<button>`s, only 27 explicit `cursor-pointer`; invisible to every screenshot gate — restored unconditionally in the compat block (review H-4);
- `hover:` now compiles inside `@media (hover: hover)` — 311 usages; the hover-revealed tooltip at `TripForm.tsx:415-419` would become unreachable on touch devices — v3 semantics restored via `@custom-variant hover (&:hover);` (review M-2);
- placeholder color `gray-400` → `currentColor/50`; stock palette moves to oklch.

**Visual re-baseline is MANDATORY, not optional** — because of the preflight/palette drift and missed-rename risk above, NOT because applied renames change rendering (they don't). Do not read this as skippable once the rename inventory verifies fully applied: the preflight/palette exposure remains regardless (review M-5). Regenerate `tests/e2e/visual-baseline.spec.ts-snapshots/planner-tripId-{1280,1440,1920}-chromium-linux.png` (`playwright test --update-snapshots`) **and eyeball them**, plus before/after full-page pairs for `/`, `/destinations/`, and one article page (review H-2 — the colorless-border components render on home/destinations, which the planner snapshots never show). (Other e2e specs are behavioral, not pixel snapshots.)

**Browser floor:** v4 requires Safari 16.4+ / Chrome 111+ / Firefox 128+ (all ~March 2023). **Accepted** (Jose, 2026-07-07; >96% global support).

---

## 4. Dependency & config changes

**Dependencies (`package.json`):**
- `tailwindcss ^3.4.19` → `^4.x`
- **add** `@tailwindcss/postcss` (v4 PostCSS plugin)
- **remove** `autoprefixer` (v4 vendor-prefixes natively via Lightning CSS) — verify no needed prefixes drop given the browser floor.
- `@tailwindcss/typography ^0.5.19` → v4-compatible release.
- `postcss` stays (Next.js PostCSS processor).

**Config transforms:**
- `tailwind.config.js` (CJS) → CSS-first `@theme` in `globals.css` (brand colors → `--color-*` tokens; font stacks → `--font-*`; a net simplification since the brand hexes become CSS variables). Content auto-detection in v4 (add `@source` only if a glob is missed).
- `postcss.config.js`: `{ tailwindcss:{}, autoprefixer:{} }` → `{ '@tailwindcss/postcss':{} }`.
- `src/app/globals.css`: `@tailwind base/components/utilities` → `@import "tailwindcss";`; typography → `@plugin "@tailwindcss/typography";`. **Preserve** the existing `box-sizing` reset, `@keyframes` (help-pulse/atlas-float/bubble-pop) + `.animate-*`, and Google Places `.pac-*` overrides. **Gain the unconditional v4-compat block** (reviews H-2/H-4/M-2): v3 default border-color (`@layer base` upgrade-guide snippet), `button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer; }`, and `@custom-variant hover (&:hover);` — ships by default, NOT gated on an eyeball (cursor and touch-hover regressions are invisible to every gate). **One sanctioned deletion** (review M-3): the unlayered `body { font-family: 'Inter', … }` rule — under v4 cascade layers, unlayered author CSS outranks all layers, so this rule (which in v3 always lost to the `font-sans` utility on `<body>`) would start winning and bypass next/font's metrics-tuned `Inter Fallback` chain.

**Held to their own later loops (out of scope):** TS 5→6, ESLint 9→10, `@types/node` 20→24.

---

## 5. Migration steps (high level — mirror the Next-16 14-task loop)
1. Pre-flight baseline (current build/lint/test/visual snapshots green) + feature branch.
2. Run `npx @tailwindcss/upgrade`.
3. Dependency bumps (§4) + `npm install`.
4. Verify config transform landed (`@theme`, `@import`, `@plugin`, postcss).
5. Build fix-loop (`npm run build`).
6. Lint (`npm run lint` — no new errors vs baseline).
7. Unit (`npm run test:unit` — 13/13; style-agnostic, low risk).
8. E2E behavioral (`npm run test:e2e`).
9. **Regenerate + manually eyeball the 3 visual baselines** (the real work), plus home/destinations/article before/after pairs (review H-2).
10. Push branch.
11. **STOP-gate — Jose visual review + prod-promote go-ahead.**
12. VPS deploy (PM2 `tpi`, via `scripts/deploy-vps.sh` / `command-post/deploy_tpi.sh`; respect the `guard_vps_deploy.py` hook — split SSH commands, `npx next build`, `pm2 reload`).
13. VPS smoke: 9 URLs all 200 + Phase-2 probes (`/api/assistant/health`, `/planner/`) non-5xx (review H-3); live-CSS v4 assertion via minification-proof markers (review B-1).
14. Merge + branch cleanup; rollback ready.

---

## 6. Verification bar + rollback
- **Gates:** build clean, lint no-new-errors, unit 13/13, e2e behavioral pass, **3 visual baselines regenerated + eyeballed** (+ home/destinations/article pairs — review H-2), VPS smoke 9×200 + Phase-2 probes non-5xx (review H-3) + live-CSS v4 markers (review B-1).
- **Rollback:** feature branch; reverting `package.json` + `postcss.config.js` + `tailwind.config.js` + `globals.css` restores v3 fully (no source-file churn beyond the codemod's class renames, which revert with the branch). Pre-written; hard STOP-gate before prod.

---

## 7. Open questions
- **O1:** Confirm `autoprefixer` removal drops no prefixes the browser floor still needs (v4/Lightning CSS should cover it — verify during the build step).
- **O2:** Does the v4 default preflight/color-palette shift affect any hardcoded-neutral usage? The border/cursor/hover legs are neutralized structurally by the unconditional compat block (reviews H-2/H-4/M-2); residual palette/placeholder drift is caught by the visual eyeball (step 9, incl. the home/destinations pairs).

---

## 8. References
- Template: `docs/superpowers/specs/2026-05-21-next-16-upgrade-design.md` + `plans/2026-05-21-next-16-upgrade.md` (TPI's VPS-shaped loop).
- `feedback_stay_on_latest_stack`; MEMORY TPI deployment (VPS 104.225.221.138, PM2 `tpi`) + `guard_vps_deploy.py` hook workaround.
- Backlog: "TPI stack-currency follow-on loops" (Loop #2).
