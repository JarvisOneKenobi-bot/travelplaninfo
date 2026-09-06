# TPI Verification Checklist

Status: Mandatory verification checklist for TPI deploys and Atlas/planner changes.

This file makes the diagnosis section 14 permanent, updated for D1-D10 and shipped Phase 0. It must be referenced by `docs/deployment/local-to-vps.md` during Phase 5. Existing assistant checks that use `|| true` must be replaced by hard gates or explicit phase-expected degraded results.

## Rules

- No deploy is complete on local evidence alone.
- Production checks must run against `https://travelplaninfo.com` unless explicitly marked local.
- Do not print secrets; env checks list key names only.
- If a phase expects Atlas to be degraded, the expected health JSON must say so. Degraded is not the same as unverified.
- Phase 0 health gate is shipped; proactive Atlas UI should remain hidden when health is false.

## Pre-deploy local gates

For code changes:
```bash
npm run lint
npm run test
npm run build
```

For docs-only changes:
```bash
git diff --check
```

For deploy scripts/env changes:
```bash
git diff --check
# plus the env preflight command once implemented
```

## VPS process and upstream gates

Run on or against the VPS after deploy:

```bash
ssh root@104.225.221.138 "pm2 status tpi"
ssh root@104.225.221.138 "ss -ltnp | grep -E '3001'"
curl -I https://travelplaninfo.com/
curl -I https://travelplaninfo.com/hot-deals/
```

Expected:
- PM2 process `tpi` online.
- Port 3001 listening behind Nginx.
- Public homepage and hot-deals return 200/3xx acceptable redirects only.

Do not use:
```bash
curl -I http://127.0.0.1:8766/ || true
```

As of 2026-07-11, D2 is complete: the FastAPI sidecar dependency has been removed, port 8766 is not part of the production architecture, and nothing listens on it. Treat the probe above as forbidden and obsolete; assistant dependency checks target the app's own `/api/assistant/health` endpoint instead.

## Environment preflight

Names only; never values.

```bash
ssh root@104.225.221.138 "cd /home/travelplaninfo/nextjs && grep -hoE '^[A-Z_0-9]+' .env .env.local 2>/dev/null | sort -u"
```

Compare against the phase-required table in `docs/product/ARCHITECTURE.md`.

Required production keys for full Atlas/planner after D2:
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `APP_BASE_URL`
- `NODE_ENV`
- `ANTHROPIC_API_KEY`
- `TRAVELPAYOUTS_TOKEN`
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY`
- `GOOGLE_GEOCODING_KEY`

Optional/feature keys:
- `OPENAI_API_KEY` for voice transcription.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Google OAuth.
- `BASE_URL` for Playwright targeting, not app runtime.

Acceptance:
- Missing required key fails deploy preflight once the script exists.
- If running before D2, missing Atlas keys must produce health false and proactive UI hidden.

## Atlas health gates

Current Phase 0 gate:
```bash
curl -sL https://travelplaninfo.com/api/assistant/health | jq .
```

Expected before D2 on current production:
```json
{
  "anthropic": false,
  "travelpayouts": false,
  "backendReachable": false,
  "healthy": false
}
```

Exact booleans may change when keys are added, but interpretation must be explicit:
- `healthy:false`: proactive Atlas UI hidden.
- `healthy:true`: proactive Atlas UI may render.

After D2 expected:
- No separate FastAPI reachability requirement.
- Health reflects in-app Anthropic + Travelpayouts readiness and any other required Atlas dependency.

Client UI smoke:
- Visit a new planner trip when health is false: no Atlas consent chip and no proactive bubble.
- Visit when health is true: consent chip may appear for eligible Path A trip.

## Atlas production E2E gate

Required after Phase 2 and for every Atlas-affecting deploy:

```bash
BASE_URL=https://travelplaninfo.com npx playwright test tests/e2e/planner-trust.spec.ts
```

Manual production smoke:
1. Open incognito/mobile-sized browser.
2. Start at an article page.
3. Click planner/start planning CTA.
4. Create guest trip with origin `MIA` and a real destination such as Cancun.
5. Confirm health permits Atlas proactive UI.
6. Click consent chip.
7. Confirm streamed response appears.
8. Confirm at least one real flight/deal card uses Aviasales/Travelpayouts marker `164743`.
9. Ask for hotels/activities/restaurants and confirm D3 partner-search handoff, not invented names/prices.
10. Confirm spend/event row recorded.

Hard requirement:
- Workstation off or command-post unavailable during the smoke. Production must not depend on local FastAPI.

## SEO gates

Sitemap count:
```bash
curl -s https://travelplaninfo.com/sitemap.xml | grep -c "<loc>"
```

Non-English article canonical sample after D5 implementation:
```bash
curl -sL https://travelplaninfo.com/es/key-west-florida-vacation-guide/ | grep -i 'rel="canonical"'
```

Expected:
- Canonical points to `https://travelplaninfo.com/key-west-florida-vacation-guide/`.

Auth noindex after Phase 4:
```bash
curl -sL https://travelplaninfo.com/signin/ | grep -i 'noindex'
curl -sL https://travelplaninfo.com/register/ | grep -i 'noindex'
```

Hub canonical after Phase 4:
```bash
curl -sL https://travelplaninfo.com/guides/ | grep -i 'rel="canonical"'
curl -sL https://travelplaninfo.com/destinations/ | grep -i 'rel="canonical"'
curl -sL https://travelplaninfo.com/hot-deals/ | grep -i 'rel="canonical"'
```

Schema sample:
```bash
curl -sL https://travelplaninfo.com/key-west-florida-vacation-guide/ | grep -E 'FAQPage|BreadcrumbList|Article'
```

Acceptance:
- Results match `SEO_MIGRATION_STRATEGY.md` matrix.

## Content-model gates

For any new or changed article JSON:
```bash
node -e "const fs=require('fs'); for (const f of process.argv.slice(1)) JSON.parse(fs.readFileSync(f,'utf8')); console.log('article json ok')" content/articles/<file>.json
```

Manual/automated checks:
- Required fields per `CONTENT_MODEL.md` exist.
- `search_location` exists for new articles.
- `schemaType` is valid.
- `faq` exists for destination guides.
- CTA insertion renders in article body.
- Images load.

## Affiliate and analytics gates

After Phase 2A/3:
```bash
# Example shape; update once event table name is implemented.
sqlite3 data/tpi.db "SELECT * FROM affiliate_click_events ORDER BY created_at DESC LIMIT 5;"
```

Manual click check:
- Click one article CTA and one planner/Atlas affiliate handoff.
- Confirm URL is from the D7 partner set.
- Confirm `rel="sponsored"` where applicable.
- Confirm event recorded without exposing PII.

GSC/lightweight analytics (D10):
- GSC property verified or blocker documented.
- Sitemap submitted.
- Event definitions documented.
- Affiliate-click-per-trip-session query works.

## Cost/ops gates

After D2:
```bash
sqlite3 data/tpi.db "SELECT date, model, usd, input_tokens, output_tokens FROM assistant_cost ORDER BY date DESC LIMIT 5;"
```

Expected:
- Spend rows appear after Atlas chat/tool use.
- Cap check prevents chat once monthly spend reaches $10.
- Alert at 80% cap exists in Phase 5.

PM2 log check:
```bash
ssh root@104.225.221.138 "pm2 logs tpi --lines 100 --nostream"
```

Expected:
- No unhandled Atlas errors during smoke window.
- No secret values printed.

## Regression floor

Protect the working business floor:
- Article pages return 200.
- Images and CTAs render.
- FAQ schema remains valid.
- Article Factory publish cadence not blocked by planner work.
- Planner manual CRUD still works when Atlas is unhealthy.
- Guest auth and trip ownership guards remain intact.

Suggested smoke URLs:
```bash
# Redirect gate — old year-slugged URLs must 308 to the evergreen slug (page AND images)
curl -I https://travelplaninfo.com/key-west-florida-vacation-guide-2026/
# expect: HTTP/2 308 · location: /key-west-florida-vacation-guide/
curl -I https://travelplaninfo.com/images/articles/key-west-florida-vacation-guide-2026/key-west-florida-vacation-guide-2026-hero.png
# expect: HTTP/2 308 · location: /images/articles/key-west-florida-vacation-guide/key-west-florida-vacation-guide-hero.png
curl -I https://travelplaninfo.com/images/articles/cape-cod-vacation-guide-2026/cape-cod-vacation-guide-2026-body-3.png
# expect: HTTP/2 308 · location: /images/articles/cape-cod-vacation-guide/cape-cod-vacation-guide-body-3.png
curl -I https://travelplaninfo.com/key-west-florida-vacation-guide/
# expect: HTTP/2 200
# Build host: `node --version` must be >= 22 (src/lib/slug-redirects.ts imports ../i18n/routing.ts)
curl -I https://travelplaninfo.com/guides/
curl -I https://travelplaninfo.com/planner/
```

## Sign-off table

Append one row to a deploy/audit note for each production deployment.

| Date | Branch/SHA | Phase | Local gates | Prod health | SEO sample | Atlas smoke | Analytics/click check | Signed off by |
|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | `<sha>` | Phase N | command + result | JSON/result | URL/result | pass/fail | pass/fail | name/model |

No row means no deploy sign-off.
