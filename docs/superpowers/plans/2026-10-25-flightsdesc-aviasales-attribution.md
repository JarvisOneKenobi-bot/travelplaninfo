# Plan: flightsDesc Aviasales attribution

Spec: `docs/superpowers/specs/2026-10-25-flightsdesc-aviasales-attribution-design.md`. Worktree `.worktrees/flightsdesc-attribution`, branch `copy/flightsdesc-aviasales-attribution`.

## Task 1: edit six strings
In each `messages/<loc>/common.json`, replace the single `"flightsDesc"` line (en:546, de:526, others:481) with the spec's table text.
Change nothing else (keep indentation and trailing comma).

## Task 2: verify (fresh output)
1. `git diff --stat` shows exactly 6 files, 1 insertion + 1 deletion each.
2. `grep -n '"flightsDesc"' messages/*/common.json` shows Aviasales in all six.
3. JSON validity: `node -e` JSON.parse each of the six files.
4. Key parity: every locale still has the same key set as `en` (`flightsDesc` present in all).
5. `npx eslint .` and `npm run test:unit` pass (report counts; note pre-existing failures vs. baseline on `main`).
6. Old strings gone: `grep -rnE "Compare hundreds of airlines for the best|cientos de aerolíneas para|centenas de companhias aéreas pela|compagnies aériennes pour|compagnie aeree per|Hunderte Airlines vergleichen" src tests messages` returns nothing.
7. `npx vitest run src/test/no-fabricated-claims.test.ts src/lib/help-content.guard.test.ts` passes (guards that scan this namespace).

## Task 3: commit locally
`copy(i18n): attribute flightsDesc to Aviasales (honesty audit 2026-07-17)`; do not push.
