# Evening Runbook — Stop TPI's prod fabrication (merge #7 + #8, deploy) — 2026-07-17

**Prereq owner:** Jose (Hermes terminal + SSH + deploy go-ahead, all evening-gated).
**Do NOT start until the GPT-5.6 audit is reconciled (Step 0).**

Verified today (read-only): both PRs OPEN + MERGEABLE; `main` = `4d5a1e7`; `git merge-tree` → #7 and #8 each merge into main **conflict-free**; the only failing CI is dead Vercel previews (prod = VPS, ignore).

---

## Step 0 — Reconcile the GPT-5.6 audit (BLOCKS everything)
The 07-15 read-only inspection post-dates the "verified SHIP" verdict. Paste it; if it names any blocker, fix before merging. **No merge until this clears.**

## Step 1 — Provision VPS secrets (Jose runs; push-guard blocks me)
Re-supply both values (staging file gone). Format check: `ANTHROPIC_API_KEY` must be `sk-ant-api…` (NOT an `sk-ant-oat` OAuth token).
```
! ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && cp .env.local .env.local.bak-\$(date +%F) && printf 'TRAVELPAYOUTS_TOKEN=%s\nANTHROPIC_API_KEY=%s\n' '<TP>' '<KEY>' >> .env.local && chmod 600 .env.local && grep -c '=' .env.local"
```
Also confirm `FASTAPI_URL` is empty/absent (that's fine post-#7 — #7 drops the last FastAPI dependency).
⚠ **Deploying WITHOUT #7 does NOT fix prod** (empty `FASTAPI_URL` → dead `localhost:8766` fallback → fabrication keeps firing). Merge #7 first.

## Step 2 — Merge #7 → #8 (order proven; #7 removes the fallback fabrication)
```
gh pr merge 7 -R JarvisOneKenobi-bot/travelplaninfo-prototype --merge
gh pr merge 8 -R JarvisOneKenobi-bot/travelplaninfo-prototype --merge
git -C /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype fetch origin && git checkout main && git pull --ff-only
```

## Step 3 — Build the honesty PR on the MERGED tree (Hermes GPT-5.5 per routing rule)
Now that #7+#8 are in `main`, execute `docs/superpowers/plans/2026-07-17-honest-compare-copy.md` (REV 3) — TWO tasks, one PR:
- **Task 1 (③):** rewrite the 3 false compare-keys ×6 locales (help-content edit dropped — #8 did it).
- **Task 2 (②):** remove the `/hot-deals` guest Deal-Alerts email-capture card + import. Base = post-#8 `hot-deals/page.tsx`.
- **Task 3 (②):** remove the `ArticleHero` "Weekly price drops" card + import + collapse the parent grid (`1fr_360px` → `w-full`), AND delete the `"Deal Alerts sidebar"` entry from `help-content.ts` (else the article Help button points to a removed form). Base = main for ArticleHero; post-merge for help-content.
Base MUST be merged main. ⚠ Tasks 2+3 drop visible cards (every article hero reflows) → Jose visual review before deploy.
(Out of scope, flagged for later: guides/LatestGuides newsletter forms — same no-sender problem, milder; remaining help-content "matched to your preferences/profile" + account-benefit alert lines.)

## Step 4 — Combined-suite gate on the ACTUAL merged tree (not per-PR)
```
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
npm run lint            # compare to main baseline (main is not lint-clean)
npm run test:unit       # expect the combined 312/312 (per memory) + ③ deltas
npm run build           # must succeed
npx playwright test tests/e2e/   # full e2e green
```
If any gate fails on the merged tree → STOP, do not deploy.

## Step 5 — Deploy to VPS (only on Jose's explicit go-ahead + visual review)
```
ssh -i ~/.ssh/id_ed25519 root@104.225.221.138 "cd /home/travelplaninfo/nextjs && git pull --ff-only && npm install --legacy-peer-deps && npx next build && pm2 reload tpi"
```
(Legacy-peer-deps: VPS Node 20 vs vitest's @types/node 22 floor — known.)

## Step 6 — Post-deploy smoke — MUST include Atlas chat (first time ON in prod)
This deploy switches Atlas ON for the first time (never had an API key). Its never-live defects become NEW user-facing bugs now — see [[feedback_preexisting_code_vs_preexisting_ux]].
1. `/api/surprise-me` with **JFK** origin and again with **LAX** → payloads must DIFFER and reflect the real origin (the bug was every request returning identical MIA fabrication).
2. `/hot-deals` → no "Live Deal Feed", no invented cruise, no fabricated prices.
3. **Atlas chat** (guest → consent → real trip): streamed reply + a real flight/deal card + working affiliate link + a spend row in `assistant_cost`. Watch for SSE framing, honest "no token ≠ no flights" behavior, Surprise-Me = prose-not-links.
4. Vibe chips: a 2-vibe combo that previously returned nothing now filters correctly (the `mountains`/`mountain` + `winter` fix).

## Rollback
`pm2` keeps the prior build; `git reflog` on the VPS + `pm2 reload` the previous commit if smoke fails. Prefer fix-forward for the honesty fixes (reverting re-enables fabrication).
