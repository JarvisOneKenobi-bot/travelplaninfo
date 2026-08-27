# Deal Alerts v1 — Design Spec (flights-only price-drop alerts)

**Date:** 2026-07-17
**Author:** Claude Code (brainstormed with Jose on RC)
**Status:** DRAFT — awaiting Jose's evening review + two prerequisite decisions
**Origin:** next_sprint item ②. Jose chose "build the alert service"; v1 scope = **flights-only, true per-route price-drop alerts.** Replaces the currently-false promise ([[docs/audits/2026-07-17-content-honesty-audit.md]]).

---

## 1. Goal & honest framing
Make the "price-drop alerts" promise on `/hot-deals` and in account preferences **real**: a logged-in user enables Deal Alerts and sets a threshold; a VPS worker checks their trips' flight routes daily against Travelpayouts and emails them when a fare drops below their threshold. Until this ships, the live copy is a false promise (see §10 interim exposure).

## 2. Scope
**In (v1):**
- Per-route **flight** price monitoring for **logged-in** users, derived from their saved trips.
- Daily VPS-scheduled price checks via the existing `searchFlights()` client.
- Threshold-based email notification (one-click unsubscribe).

**Out (explicit non-goals, YAGNI):**
- **Hotels / cars / cruises** — no price API today (hotels = single Hotels.com affiliate link). Hotel alerts would need Hotellook (same TP account, separate future integration). The copy must stop promising "hotel" alerts.
- **Guest (no-account) alerts** — the `/hot-deals` hero collects only an email, no route; true per-route alerts need a route. See §8 for existing collected emails.
- **A separate weekly digest** — considered and dropped for v1.

## 3. Feasibility grounding (verified in code, not assumed)
| Need | Exists today | Location |
|---|---|---|
| Origin airport | `home_airport` pref (IATA, clamped) | `preferences.ts:13,135` |
| Route destination + origin | `trips.destination NOT NULL` + origin migration | `db.ts:34,189` |
| User threshold | `deal_alert_threshold_pct` (default 20, clamped 0–100) | `preferences.ts:34,164` |
| Enable toggle | `enableDealAlerts` UI | `account/preferences/page.tsx:479` |
| Flight price fetch | `searchFlights()`, `getDeals()`, `getPopularRoutes()` | `atlas/travelpayouts-client.ts:425,519,567` |
| **Email delivery** | **NONE — must add** (see §7) | — |
| **Watch/price-history storage** | **NONE — must add** (see §6) | — |

## 4. Architecture
```
[User enables alerts + threshold]  ──▶  account/preferences (existing UI)
        │
        ▼
[alert_watches]  ◀── derived from trips (origin→dest) on enable / trip save
        │
        ▼
[VPS cron: daily]  ──▶  alert-worker.ts
        │  for each active watch:
        │    price = searchFlights(origin, dest, dates)     ← existing client
        │    if price ≤ baseline·(1 − pct/100) and not already alerted at/below:
        │        enqueue email
        ▼
[email provider (Resend)]  ──▶  user  +  [alert_sent ledger]  (dedupe)
```
- **No new user-facing route picker.** Watches are created from existing trips when a user has `enableDealAlerts` on. Origin = trip origin, else `home_airport`.
- **Worker runs on the VPS** (always-on), NOT this workstation (it sleeps — [[project_workstation_not_24_7]]). Delivery mechanism: a `node` script invoked by **VPS cron** (or a `pm2` cron-restart process), reusing the app's `src/lib` modules.

## 5. Threshold / baseline semantics
- **Baseline** = the first observed fare when the watch is created (stored on the watch). Alert fires when `current ≤ baseline · (1 − pct/100)`.
- **Re-alert guard:** record the fare we last alerted at in `alert_sent`; do not re-notify unless the price drops a further threshold step below the last alerted price (prevents daily spam on a sustained low fare).
- **Baseline refresh:** if the fare *rises* and stays up for N days, refresh baseline (avoids a stale-high baseline that never triggers). N configurable; default 14.

## 6. Data model (new tables in `db.ts`)
```sql
CREATE TABLE alert_watches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  origin TEXT NOT NULL, destination TEXT NOT NULL,
  depart_date TEXT, return_date TEXT,          -- nullable = "cheapest in window"
  threshold_pct INTEGER NOT NULL,              -- snapshot of pref at creation
  baseline_price_value REAL, baseline_currency TEXT,
  baseline_observed_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, origin, destination, depart_date)
);
CREATE TABLE alert_sent (
  id INTEGER PRIMARY KEY,
  watch_id INTEGER NOT NULL REFERENCES alert_watches(id) ON DELETE CASCADE,
  alerted_price_value REAL, currency TEXT,
  sent_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```
(`newsletter_subscribers` stays for a future guest-digest; it is NOT used by v1.)

## 7. Email provider — **Jose-provides prerequisite**
- **Recommendation: Resend** (`resend` npm; simple API; free tier ~100/day, 3k/mo; native React email templates). Alternatives: Postmark, SES, SendGrid.
- Requires: a Resend account, a verified sending domain (`alerts@travelplaninfo.com` — DNS/SPF/DKIM on the VPS domain), and `RESEND_API_KEY` in the VPS `.env.local` (same channel as the other secrets).
- **Cost:** free at expected volume; flag if list grows.
- CAN-SPAM: physical address + one-click unsubscribe token in every email.

## 8. Existing collected prod emails — **Jose-decides**
The prod `newsletter_subscribers` table may hold real emails collected under the false "price-drop alerts" promise (I can't read prod's SQLite from here). They have **no route**, so v1 per-route alerts can't serve them. Options: (a) one-time re-engagement email inviting them to create an account + enable alerts; (b) purge (cleanest, honors that they consented to *alerts* not marketing); (c) hold for the future guest-digest. **Decide before launch.**

## 9. ⚠ TWO DIFFERENT SURFACES — v1 fixes one, the lie is on the other
This is the crux (surfaced in advisor review; corrects an earlier draft that wrongly said "when v1 ships the promise becomes true"):

| Surface | What it is | Does v1 fix it? |
|---|---|---|
| **Account preferences** (`enableDealAlerts` + `alertThreshold`, logged-in) | The toggle v1 wires to the real worker | ✅ YES — v1 makes this true (flights-only) |
| **`/hot-deals` guest hero** (`dealAlertsDesc` + `NewsletterForm`, logged-OUT, no route) | The email capture that says "✓ You're subscribed!" and does nothing | ❌ **NO** — v1 is trip-derived + logged-in; a guest has no account and no route, so v1 **never serves this surface** |

**Consequence:** building v1 does NOT retire the promise on the page people actually see. When v1 ships, `dealAlertsDesc` on `/hot-deals` is **still a false promise still collecting emails under false pretense.** The preferences copy becomes true; drop "hotel" → "Flight price-drop alerts on your planned routes."

## 10. ⚠ The `/hot-deals` guest hero fix is REQUIRED, not optional — and it's the actual harm-stopper
Because §9: the guest hero must be resolved **regardless of the build, and it stays resolved until a real guest flow exists** — it is not "interim." Options (Jose decides):
- **(a) Remove/gate the hero email capture** — cleanest; stops the false promise + the data collection now. Fold into tonight's item-③ PR.
- **(b) Add a guest flow to scope** — either a real guest-digest sender (was a v1 non-goal) or "create an account to get price alerts" CTA. Bigger.
- **(c) "Coming soon" + disable the form** — honest holding state.
"Build the alert service" alone leaves (a/b/c) unaddressed. **This is the item that actually stops the lying;** the build is an enhancement for a *different* (logged-in) surface.

## 11. Error handling
- TP failures (rate-limit/timeout/no-token) → skip that watch this run, log cause (reuse `tpGet` cause labels from F2); never email on missing data.
- Email send failure → retry with backoff; dead-letter after N; never mark `alert_sent` unless provider accepted.
- Worker is idempotent per day (a re-run doesn't double-send — guarded by `alert_sent`).

## 12. Testing
- Unit: threshold/baseline math (drop triggers, re-alert guard, baseline refresh); watch derivation from trips; unsubscribe-token round-trip.
- Integration: worker run against a mocked `searchFlights` (no live TP in CI) — asserts email enqueued iff below threshold, deduped on re-run.
- E2E: enable alerts in preferences → watch row created; unsubscribe link deactivates.
- Live smoke (pre-launch, real creds): one real route, force a low baseline, confirm a real email arrives with a working unsubscribe.

## 13. Open decisions to confirm in review
1. **`/hot-deals` guest hero (REQUIRED — the actual harm-stopper, §9/§10):** (a) remove/gate the email capture / (b) add a guest flow to scope / (c) "coming soon" + disable form. Independent of, and more urgent than, the build.
2. Email provider = **Resend**? (Jose-provides account + `RESEND_API_KEY` + domain DNS.)
3. Existing collected emails → (a) re-engage / (b) purge / (c) hold. (§8)
4. Watch source = saved trips only (v1), or also a per-route "watch this fare" button? (Default: trips only.)
