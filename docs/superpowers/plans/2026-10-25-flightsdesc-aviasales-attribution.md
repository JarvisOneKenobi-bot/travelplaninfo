# Plan: flightsDesc Aviasales attribution

Spec: `docs/superpowers/specs/2026-10-25-flightsdesc-aviasales-attribution-design.md`. Worktree `.worktrees/flightsdesc-attribution`, branch `copy/flightsdesc-aviasales-attribution`.

## Task 1: edit six strings
In each `messages/<loc>/common.json`, replace the single `"flightsDesc"` line (en:546, de:526, others:481) with the spec's table text.
Change nothing else (keep indentation and trailing comma).

## Task 2: verify (fresh output)
1. `git diff --stat` shows exactly 6 files, 1 insertion + 1 deletion each.
2. `for l in en pt es fr it de; do node -e "const m=require('./messages/$l/common.json');console.log('$l',JSON.stringify(Object.values(m).flatMap(function f(v){return typeof v==='object'?Object.values(v).flatMap(f):[v]}).filter(s=>typeof s==='string'&&/flightsDesc/.test(s)))" ; done` is unnecessary; instead
   `grep -n '"flightsDesc"' messages/*/common.json` shows Aviasales in all six.
3. JSON validity: `node -e` JSON.parse each of the six files.
4. Key parity: every locale still has the same key set as `en` (`flightsDesc` present in all).
5. `npx eslint .` and `npm run test:unit` pass (report counts; note pre-existing failures vs. baseline on `main`).
6. `grep -rn "Compare hundreds of airlines for the best" src tests messages` returns nothing.

## Task 3: commit locally
`copy(i18n): attribute flightsDesc to Aviasales (honesty audit 2026-07-17)`; do not push.
