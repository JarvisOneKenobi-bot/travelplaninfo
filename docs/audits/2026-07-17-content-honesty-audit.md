# TPI Content-Honesty Audit — Items ② & ③ (2026-07-17)

**Author:** Claude Code (read-only investigation, nothing edited/merged/deployed)
**Trigger:** `resume tpi next_sprint todos` — items ② (`dealAlertsDesc`) and ③ (compare-prices copy) from next_sprint.
**Method:** Verified every claim against the live code instead of trusting the 3-day-old notes. Memory undercounted ③ as "one line"; it is a cluster.

> The rule throughout: **the fix for a false claim is never a different claim we invent.** Where a claim is defensible with attribution, keep + attribute; where it is false, remove or rewrite to the truth.

---

## Item ② — Deal Alerts: a promise with no backend (CRITICAL — SOL flagged twice)

### What the code actually does (evidence)
- `messages/en/common.json:343` — `dealAlertsDesc`: *"Weekly flight + hotel bundles with price-drop alerts."*
- `hot-deals/page.tsx:172-179` renders that heading/desc above a `<NewsletterForm source=...>` + *"No spam. Unsubscribe anytime."*
- `NewsletterForm.tsx` → POSTs to `/api/newsletter`.
- `/api/newsletter/route.ts` → `INSERT INTO newsletter_subscribers (email, source)` and returns 201 → UI shows **"✓ You are subscribed! Thanks for joining."**
- `newsletter_subscribers` is referenced in **exactly three** places repo-wide: the `CREATE TABLE` (`db.ts:62`), a dedup `SELECT id ... WHERE email=?`, and the `INSERT` — **all inside the same POST handler.** Nothing ever reads it to send anything.
- **Zero send-infrastructure** in the entire codebase: no `nodemailer`/`sendgrid`/`resend`/`sendEmail`/`cron`/`worker`/`scheduler`/price-monitor.
- `account/preferences` exposes `enableDealAlerts` + `alertThreshold` (`deal_alert_threshold_pct`) toggles — **no consumer** reads these either.

### The reality
A visitor enters their email for "weekly price-drop alerts," is told they're subscribed, the email is **persisted forever**, and **no alert or email of any kind will ever be sent.** This is collection of personal data under false pretenses — not merely a passive false claim.

### ⚠ Prod data-ethics flag
There may already be **real subscriber emails** in prod's SQLite `newsletter_subscribers` collected under this promise. I can't read prod's DB from here (needs your SSH). Whatever we decide, the already-collected rows need a call (honor / purge).

### Decision required (genuinely yours — build vs. remove)
- **A. Remove the promise (recommended, ships today):** delete the "price-drop alerts" framing + the inert `enableDealAlerts`/`alertThreshold` UI. Either remove the email capture on `/hot-deals` entirely, **or** — only if you commit to actually sending one — reframe it as a plain *"travel newsletter"* signup. (There is no newsletter sender today either, so "newsletter" is only honest if you build/queue one.) Backlog "Deal Alerts" as a real feature.
- **B. Build the service:** price-monitor + email provider + alert worker + delivery. This is a **feature**, not a copy fix (needs an email provider, a cron/worker, price polling, unsubscribe handling). Weeks, not minutes.
- **Either way:** decide the fate of already-collected prod emails.

---

## Item ③ — "We compare prices": TPI compares nothing site-wide

### Premise (evidence)
- `src/config/affiliates.ts`: one partner per category (Hotels.com / Vrbo / EconomyBookings / CruiseDirect / Aviasales / Klook). **No cross-site aggregation.**
- The only `Math.min(...price)` in the app is `TripResultsModal.tsx` — cheapest among flights Atlas already fetched from **one** source (Travelpayouts). Not "100+ booking sites."
- **Nuance:** *flights* resolve to **Aviasales** (a genuine airline metasearch) and *cars* to **EconomyBookings** (a genuine supplier aggregator). So "compare flights/airlines" and "compare car suppliers" are TRUE **with attribution**. Only the first-person, site-wide, hotel-inclusive "**we** compare prices across all booking sites" claims are false.

### Per-claim ledger (all in `messages/en/common.json` unless noted — replicate ×6 locales)

| Line / file | Current text | Verdict | Proposed honest text |
|---|---|---|---|
| `35` `smartSearchDesc` | "We compare prices across 100+ booking sites" | ❌ FALSE | "Search flights, hotels, cars & cruises through our trusted booking partners." |
| `306` `subheading` | "…We compare prices across major booking sites to get you the best deal." | ❌ FALSE | "Find flights and hotels to top destinations through our trusted booking partners." |
| `317` `dontSeeDesc` | "We search hundreds of airlines and hotel booking sites to find you the best prices anywhere in the world." | ❌ FALSE | "Tell us where you want to go and we'll connect you with the right booking partner for your trip." |
| `help-content.ts:79` | "We scan flights, hotels, and vacation packages across our affiliate partners to find the best prices." | ❌ FALSE | "We link you to offers from our booking partners — Hotels.com, Vrbo, EconomyBookings & CruiseDirect." |
| `521` `flightsDesc` | "Compare hundreds of airlines for the best fare." | ✅ KEEP (attribute) | "Compare hundreds of airlines on Aviasales for the best fare." |
| `444` `placeholderFlightDesc` | "Search and compare flights for the best fare." | ✅ KEEP (attribute) | "Search and compare flights on Aviasales." |
| `524/525` `compareCarsTitle/Desc` | "Compare 500+ Car Rental Suppliers" / "EconomyBookings finds the cheapest available rate." | ⚠ KEEP pending ④ | verify "500+" against current EconomyBookings terms (item ④), else soften |
| `528` `carsDesc` | "Compare top brands — Hertz, Enterprise, Sixt & more." | ✅ KEEP (via EconomyBookings) | (optionally attribute) |
| `449` `placeholderCarDesc` | "Compare rental options from top providers." | ✅ KEEP (via EconomyBookings) | — |
| `332` `subheading` | "Compare hotels on Hotels.com, vacation rentals on Vrbo… Every booking supports TravelPlanInfo." | ✅ KEEP (honest + disclosure) | — |
| `509` `luxuryHotelsDesc` | "…Hotels.com Price Match Guarantee." | ⚠ item ④ | verify Hotels.com still runs Price Match, else remove |
| `68/69/71` Atlas cheapest-dates | "Let Atlas find the cheapest dates…" | ✅ KEEP | Atlas genuinely searches flexible dates via Travelpayouts |

### Decision required
Confirm the policy: **rewrite the ❌ FALSE first-person "we compare" claims to the truth; keep the ✅ attributed/partner-accurate ones.** Then I draft the exact diffs across all 6 locales and run it through the pipeline (multi-file → full 7-step).

---

## Item ④ (lower priority — sign-offs)
- **Winter Escapade** translations: ✅ **RESOLVED (verified 2026-07-17).** The label ships via **PR #7** (`Winter Escape`→`Winter Escapade`), which also fixes the broken vibe filter. All 6 locales confirmed on #7: en `Winter Escapade` · es `Escapada de Invierno` · pt `Escapada de Inverno` · fr `Escapade Hivernale` · de `Winterabenteuer` · it `Avventura Invernale` (de/it use "Adventure" — no clean escapade cognate; intentional). Sound — just needs Jose's nod. (NB: current pre-#7 main has the OLD labels `Winter Escape`/`Winterflucht`/`Fuga Invernale` — the sign-off applies to #7's version.)
- **Partner claims:**
  - `EconomyBookings "500+ suppliers"` (5 spots: `common.json:524`, `affiliates.ts:85,204`, `ArticleAffiliateCTA.tsx:39`) — EconomyBookings' **own marketing figure**, always attributed to them → **defensible, keep.**
  - `Hotels.com Price Match Guarantee` (`common.json:509`) — real program historically, but **verify it's still active from the CJ/partner account** (Jose has that access; a web guess isn't authoritative). Remove the sentence if discontinued.
- **Booking-link date mismatch**: product decision (all displayed data is real; the "obvious" fix yields a one-day-trip link).

---

## Phase 2 — Full email-capture + help-content inventory (added 2026-07-17 after "continue")
The false "deal alerts" promise is **not one surface — it's four `NewsletterForm` placements**, all POSTing to the same `newsletter_subscribers` table that no sender ever reads. Complete map:

| Surface | The promise | Severity | Disposition |
|---|---|---|---|
| `/hot-deals` (`dealAlertsDesc`) | "Weekly flight + hotel bundles with price-drop alerts" | ❌ acute (undeliverable price alerts) | **DECIDED: remove** → plan Task 2 |
| **`ArticleHero.tsx:74-78`** (`source="hero"`) | **"Deal Alerts / Weekly price drops on flights, hotels & cruises"** | ❌ **acute — SAME lie on EVERY article** (biggest surface) | **NEEDS DECISION** — recommend fold into Task 2 (self-contained `hidden lg:flex` card, identical fix) |
| `guides/page.tsx:45-50` (`newsletterTitle/Subtitle`) | "Get travel tips in your inbox / weekly deals, itinerary tips…" | ⚠ milder (undeliverable newsletter) | needs call: build a real sender, or remove |
| `LatestGuides.tsx:90` (`source="latest-guides"`) | "Get the latest travel tips and deals" | ⚠ milder | same call as guides |

**Other capture forms:** only `signin`/`register` (legitimate auth) — no other hidden capture surfaces.

**help-content.ts false/misleading lines** (a small honesty pass; some fixed by #8):
- `:18` "Curated travel deals **matched to your preferences and budget**… get better matches" — ❌ static `DEALS`, no matching.
- `:77` "Curated travel deals **matched to your profile**" — ❌ same.
- `:80` "get deals that **match your travel style**… the better the deals" — ❌ same.
- `:65` "get **weekly price drop alerts**" · `:17` "unlock… **deal alerts**" · `:81` "get **notified when prices drop**" — ❌ describe the unbuilt ② feature (true only once v1 ships).
- `:79` "We scan… to find the best prices" — removed by **#8** already.
- `:82` "compare prices on our partner **sites**" — each deal → one site; singular nit.

## Scope / pipeline note (CORRECTED)
③-rewrite + ②-hero-removal touch `messages/{en,es,pt,fr,de,it}/common.json` + `hot-deals/page.tsx` (+ `ArticleHero.tsx` if extended). Multi-file → **full 7-step pipeline**. ⚠ **NOT independent of #7/#8** (an earlier draft claimed this — Fable corrected it): both PRs modify these same catalogs + `hot-deals/page.tsx` + `help-content.ts`, so the honesty PR **must build on the post-#7+#8 tree** (merge order #7 → #8 → honesty PR). Plan `docs/superpowers/plans/2026-07-17-honest-compare-copy.md` (REV 3) reflects this.
