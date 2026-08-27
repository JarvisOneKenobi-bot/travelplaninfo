# TPI Honesty PR — Compare-Copy (③) + Deal-Alerts capture removal (②)  · REV 5

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox (`- [ ]`) steps.
> **REV 2 folded in the Fable plan-review:** base rebased onto #7+#8; help-content edit dropped; `dontSeeDesc` regrounded; 18 exact FROM strings; exact `grep -F` guards; `subheading`@332 out of scope.
> **REV 3 (Jose decision + advisor catch):** adds **Task 2 — remove the `/hot-deals` guest Deal-Alerts email capture.** Rationale: v1 Deal Alerts (spec §9) serves only logged-in trip routes; the `/hot-deals` guest hero (`dealAlertsDesc` + `NewsletterForm`, no route, "✓ You're subscribed!") is the surface that's actually lying + collecting emails, and the build never touches it. Jose chose "remove/gate it now," fold into this PR.
> **REV 4 (Jose decision — "all acute price-alert lies"):** adds **Task 3 — remove the `ArticleHero` "Weekly price drops" Deal-Alerts card.** Same undeliverable lie as `/hot-deals`, but on **every article hero** (the biggest surface). The 2 generic newsletter forms (`guides`/`LatestGuides`) are deliberately left for a separate decision.
> **REV 5 (Fable review of the removals):** Blocker — Task 3 must ALSO delete the `"Deal Alerts sidebar"` help entry in `help-content.ts` (else every article's Help button points to a removed form — violates `feedback_update_help_with_features`). Task 2 guard tightened (`No spam` / `dealAlerts` prefix). Framing corrected below.

**Goal:** Replace the false "we compare prices across booking sites" claims with truthful copy (all 6 locales), AND remove every acute undeliverable "price-drop alerts" email capture (`/hot-deals` + `ArticleHero`) plus its help documentation — without altering claims that are actually true.

**Architecture:** Two parts — (1) content edits to 3 keys in `messages/{en,es,pt,fr,de,it}/common.json` (Task 1); (2) removal of two dead email-capture cards in TSX components + one help-content entry (Tasks 2–3). Verified by exact-string guards + `lint` + `build` + e2e.

**Tech Stack:** next-intl JSON message catalogs.

## Base (REV 2 — critical)
Build on **`main` AFTER #7 and #8 are merged** (evening runbook Steps 2). Reasons, verified via `git diff`:
- #7 (`surprise-me`) changes 32 lines of `en/common.json`; #8 (`kill-prices`) changes 3 (`tagline`, `affiliateDisclosure`, `cruisesDesc`) + **deletes the `help-content.ts` "How deals work / We scan…" line entirely.**
- Therefore ③'s former help-content edit is **superseded by #8 — DROP it.**
- ③'s 3 catalog keys (`smartSearchDesc`@35, destinations `subheading`@306, `dontSeeDesc`@317) are **untouched by #7/#8 and remain false after the merge** — confirmed by `git show fix/kill-hardcoded-prices:messages/en/common.json`. They are the entire ③ deliverable.

## Global Constraints (verbatim)
- **The fix for a false claim is never a different claim we invent.** Every TO string must be literally true given `src/config/affiliates.ts` (one partner per category; no cross-site aggregation) and the real UI.
- **`dontSeeDesc` sits above two static buttons** (`destinations/page.tsx:322-338`): "Search All Flights" → Aviasales homepage (`aviasales.com/?marker=`), "Search All Hotels" → `CJ_LINKS.hotels()` (Hotels.com). No input, no partner-selection logic — copy must not imply either.
- **`subheading` repeats 4× per locale** (planner ~33, destinations ~306, guides ~324, **deals ~332**). Only **306** changes. **332** ("Compare hotels on Hotels.com…/vergleichen/Confronta…") is TRUE (attributed + disclosure) — **do NOT touch it**, even though it contains "compare".
- **Locale parity, values only.** No key added/removed.

## OUT of scope (assessed TRUE — do NOT change)
`flightsDesc`, `placeholderFlightDesc` (Aviasales metasearch), `compareCarsTitle/Desc`, `carsDesc`, `placeholderCarDesc` (EconomyBookings aggregator), `subheading`@332, `ArticleAffiliateCTA.tsx:60` ("Compare hundreds of airlines…" → Aviasales, true).

## Item ② surfaces — what's IN vs. OUT of this PR
**IN (Task 2):** the `/hot-deals` guest Deal-Alerts email-capture block (`dealAlertsDesc` + `NewsletterForm source="hot-deals"`).
**IN (Task 3):** the `ArticleHero` "Weekly price drops" Deal-Alerts card (`NewsletterForm source="hero"`) — every article. Both per Jose "remove all acute price-alert lies."

**IN (Task 3, help coupling):** the `"Deal Alerts sidebar"` entry in `help-content.ts` (documents the removed hero form).

**OUT — separate follow-up decisions (do NOT fix here; flag to Jose):**
- **The 2 generic newsletter forms** — `guides/page.tsx` + `LatestGuides.tsx` — a generic "subscribe" with the SAME no-sender problem ("✓ You're subscribed!" → `newsletter_subscribers`, never sent). Milder than the price-alert lie; own call (build a real sender, or remove). (ArticleHero + hot-deals are IN, Tasks 2/3.)
- `help-content.ts` (cite by content — line numbers shift on merge): `"deals matched to your preferences"` / `"matched to your profile"` / `"match your travel style"` (static DEALS, no matching); `"get notified when prices drop below your threshold"` (preferences toggle — describes unbuilt v1); `"unlock… deal alerts"` (account benefits). Belong to the ② build / a help-content honesty pass.
- The `enableDealAlerts`/`alertThreshold` **preferences toggle** is v1's target surface — left intact (it becomes real when v1 ships).

---

### Task 1: Rewrite 3 keys × 6 locales (exact FROM → TO)

**Files:** Modify `messages/{en,es,pt,fr,de,it}/common.json` — 3 values each (18 edits).

**`smartSearchDesc`** (no trailing period, match original):
| loc | FROM (exact) | TO |
|---|---|---|
| en | `We compare prices across 100+ booking sites` | `Search flights, hotels, cars & cruises through our trusted booking partners` |
| es | `Comparamos precios en más de 100 sitios de reservas` | `Busca vuelos, hoteles, autos y cruceros con nuestros socios de reservas de confianza` |
| pt | `Comparamos preços em mais de 100 sites de reservas` | `Busque voos, hotéis, carros e cruzeiros com nossos parceiros de reservas confiáveis` |
| fr | `Nous comparons les prix sur plus de 100 sites de réservation` | `Recherchez des vols, hôtels, voitures et croisières via nos partenaires de réservation de confiance` |
| de | `Wir vergleichen Preise auf über 100 Buchungsseiten` | `Suchen Sie Flüge, Hotels, Mietwagen und Kreuzfahrten über unsere vertrauenswürdigen Buchungspartner` |
| it | `Confrontiamo i prezzi su oltre 100 siti di prenotazione` | `Cerca voli, hotel, auto e crociere tramite i nostri partner di prenotazione affidabili` |

**`subheading`@306 (destinations — the value beginning "Find the best flights…"):**
| loc | FROM (exact) | TO |
|---|---|---|
| en | `Find the best flights and hotels to top destinations. We compare prices across major booking sites to get you the best deal.` | `Find flights and hotels to top destinations through our trusted booking partners.` |
| es | `Encuentra los mejores vuelos y hoteles en los principales destinos. Comparamos precios en los principales sitios de reservas para conseguirte la mejor oferta.` | `Encuentra vuelos y hoteles a los principales destinos con nuestros socios de reservas de confianza.` |
| pt | `Encontre os melhores voos e hotéis nos principais destinos. Comparamos preços nos principais sites de reservas para garantir a melhor oferta.` | `Encontre voos e hotéis para os principais destinos com nossos parceiros de reservas confiáveis.` |
| fr | `Trouvez les meilleurs vols et hôtels vers les principales destinations. Nous comparons les prix sur les principaux sites de réservation pour vous obtenir la meilleure offre.` | `Trouvez des vols et des hôtels vers les principales destinations via nos partenaires de réservation de confiance.` |
| de | `Finden Sie die besten Flüge und Hotels zu den beliebtesten Reisezielen. Wir vergleichen Preise auf den wichtigsten Buchungsseiten für das beste Angebot.` | `Finden Sie Flüge und Hotels zu den beliebtesten Reisezielen über unsere vertrauenswürdigen Buchungspartner.` |
| it | `Trova i migliori voli e hotel nelle principali destinazioni. Confrontiamo i prezzi sui principali siti di prenotazione per ottenere la migliore offerta.` | `Trova voli e hotel verso le principali destinazioni tramite i nostri partner di prenotazione affidabili.` |

**`dontSeeDesc`@317 (regrounded — describes the two real buttons, no invented logic):**
| loc | FROM (exact) | TO |
|---|---|---|
| en | `We search hundreds of airlines and hotel booking sites to find you the best prices anywhere in the world.` | `Our booking partners cover flights and hotels worldwide. Search any destination using the buttons below.` |
| es | `Buscamos en cientos de aerolíneas y sitios de reservas de hoteles para encontrarte los mejores precios en cualquier parte del mundo.` | `Nuestros socios de reservas cubren vuelos y hoteles en todo el mundo. Busca cualquier destino con los botones de abajo.` |
| pt | `Buscamos em centenas de companhias aéreas e sites de hotéis para encontrar os melhores preços em qualquer lugar do mundo.` | `Nossos parceiros de reservas cobrem voos e hotéis no mundo todo. Pesquise qualquer destino usando os botões abaixo.` |
| fr | `Nous recherchons dans des centaines de compagnies aériennes et de sites d'hôtels pour vous trouver les meilleurs prix partout dans le monde.` | `Nos partenaires de réservation couvrent les vols et les hôtels dans le monde entier. Cherchez n'importe quelle destination avec les boutons ci-dessous.` |
| de | `Wir suchen bei Hunderten von Airlines und Hotelbuchungsseiten, um die besten Preise weltweit zu finden.` | `Unsere Buchungspartner decken Flüge und Hotels weltweit ab. Suchen Sie jedes Reiseziel mit den Schaltflächen unten.` |
| it | `Ricerchiamo centinaia di compagnie aeree e siti di hotel per trovare i migliori prezzi ovunque nel mondo.` | `I nostri partner di prenotazione coprono voli e hotel in tutto il mondo. Cerca qualsiasi destinazione con i pulsanti qui sotto.` |

- [ ] **Step 1: Baseline — the 18 exact FROM strings are present (before edit)**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype
n=0; for loc in en es pt fr de it; do
  for s in "We compare prices across 100+ booking sites" "Comparamos precios en más de 100 sitios" "Comparamos preços em mais de 100 sites" "Nous comparons les prix sur plus de 100" "Wir vergleichen Preise auf über 100" "Confrontiamo i prezzi su oltre 100"; do :; done
done
grep -rFc "compare prices across" messages/en/common.json   # sanity: EN present
```
(The mechanical implementer applies the table by exact FROM match per file; this step is a sanity check that the tree is the expected post-#7+#8 base.)

- [ ] **Step 2: Apply all 18 replacements** exactly as tabled, matching each locale's exact FROM value in its file. Preserve indentation, trailing commas, and quoting. `subheading`: match the FROM beginning "Find the best flights…"/"Encuentra los mejores…" etc. — this uniquely identifies line 306 (NOT 33/324/332).

- [ ] **Step 3: Guard — assert every OLD false string is GONE (exact, locale-complete)**

```bash
FAIL=0
for s in \
 "We compare prices across 100+ booking sites" \
 "Comparamos precios en más de 100 sitios de reservas" \
 "Comparamos preços em mais de 100 sites de reservas" \
 "Nous comparons les prix sur plus de 100 sites de réservation" \
 "Wir vergleichen Preise auf über 100 Buchungsseiten" \
 "Confrontiamo i prezzi su oltre 100 siti di prenotazione" \
 "We compare prices across major booking sites" \
 "Comparamos precios en los principales sitios de reservas" \
 "Comparamos preços nos principais sites de reservas" \
 "Nous comparons les prix sur les principaux sites de réservation" \
 "Wir vergleichen Preise auf den wichtigsten Buchungsseiten" \
 "Confrontiamo i prezzi sui principali siti di prenotazione" \
 "We search hundreds of airlines and hotel booking sites" \
 "Buscamos en cientos de aerolíneas y sitios de reservas de hoteles" \
 "Buscamos em centenas de companhias aéreas e sites de hotéis" \
 "Nous recherchons dans des centaines de compagnies aériennes" \
 "Wir suchen bei Hunderten von Airlines und Hotelbuchungsseiten" \
 "Ricerchiamo centinaia di compagnie aeree e siti di hotel" ; do
  if grep -rqF "$s" messages/; then echo "STILL PRESENT: $s"; FAIL=1; fi
done
[ $FAIL -eq 0 ] && echo "GUARD PASS: no false claims remain" || echo "GUARD FAIL"
```
Expected: `GUARD PASS`.

- [ ] **Step 4: Guard — assert every NEW string is present (exact, all 18)**

```bash
FAIL=0
for s in \
 "Search flights, hotels, cars & cruises through our trusted booking partners" \
 "Busca vuelos, hoteles, autos y cruceros con nuestros socios de reservas de confianza" \
 "Busque voos, hotéis, carros e cruzeiros com nossos parceiros de reservas confiáveis" \
 "Recherchez des vols, hôtels, voitures et croisières via nos partenaires de réservation de confiance" \
 "Suchen Sie Flüge, Hotels, Mietwagen und Kreuzfahrten über unsere vertrauenswürdigen Buchungspartner" \
 "Cerca voli, hotel, auto e crociere tramite i nostri partner di prenotazione affidabili" \
 "Find flights and hotels to top destinations through our trusted booking partners." \
 "Our booking partners cover flights and hotels worldwide. Search any destination using the buttons below." ; do
  if ! grep -rqF "$s" messages/; then echo "MISSING: $s"; FAIL=1; fi
done
[ $FAIL -eq 0 ] && echo "PRESENCE PASS" || echo "PRESENCE FAIL"
```
Expected: `PRESENCE PASS` (spot-checks the representative NEW strings; extend to all 18 if desired).

- [ ] **Step 5: JSON parses in all 6 locales**

```bash
for loc in en es pt fr de it; do python3 -m json.tool messages/$loc/common.json > /dev/null && echo "$loc OK" || echo "$loc BROKEN"; done
```
Expected: all `OK`.

- [ ] **Step 6: Lint** — `npm run lint` (compare to main baseline; main is not lint-clean — require NO NEW errors, not zero).

- [ ] **Step 7: Build** — `npm run build` (must succeed).

- [ ] **Step 8: E2E** — `npx playwright test tests/e2e/` (full suite; if any test asserts an OLD false string, update it to the NEW string and flag).

- [ ] **Step 9: Commit**

```bash
git add messages/ docs/audits/2026-07-17-content-honesty-audit.md docs/superpowers/plans/2026-07-17-honest-compare-copy.md
git commit -m "fix(honesty): replace false 'we compare prices across sites' claims with truthful copy (3 keys × 6 locales)"
```
(Note: `messages/` only — NO `src/lib/help-content.ts` in ③.)

---

### Task 2: Remove the `/hot-deals` guest Deal-Alerts email capture (item ②)

**Base:** the **post-#8** version of the file (`git show fix/kill-hardcoded-prices:"src/app/[locale]/hot-deals/page.tsx"`) — #8 rewrites this file (11+/18−), so edit the merged version, not main's.

**File:** Modify `src/app/[locale]/hot-deals/page.tsx`.

**Remove this entire block** (the Deal-Alerts card — post-#8 it sits ~lines 164–173, in the right-hand column after the "Browse all guides" link):
```jsx
            <div className="bg-teal-800 rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-bold text-white">{t("dealAlerts")}</h2>
              <p className="text-teal-100 text-sm mt-2">
                {t("dealAlertsDesc")}
              </p>
              <div className="mt-4">
                <NewsletterForm source="hot-deals" />
              </div>
              <p className="text-xs text-teal-300 mt-2">No spam. Unsubscribe anytime.</p>
            </div>
```
**Also remove the now-unused import** (post-#8 line 8): `import NewsletterForm from "@/components/NewsletterForm";` — `NewsletterForm` has no other usage in this file (verify with the guard below). Do NOT delete the `NewsletterForm` component or its other-page usages (guides/ArticleHero/LatestGuides) — out of scope.

Leave the surrounding grid intact (the block is a self-contained card; removing it just drops one card from the sidebar column). Do NOT remove the `dealAlerts`/`dealAlertsDesc` catalog keys (harmless if unused; avoids locale churn).

- [ ] **Step 1: Confirm the block + import exist on the post-#8 tree**

```bash
git show fix/kill-hardcoded-prices:"src/app/[locale]/hot-deals/page.tsx" | grep -nE "NewsletterForm|dealAlertsDesc"
```
Expected: import line + `dealAlertsDesc` render + `<NewsletterForm source="hot-deals" />` all present.

- [ ] **Step 2: Delete the card block + the import** (as above).

- [ ] **Step 3: Guard — the guest capture is gone from this page (catches a partial removal too)**

```bash
grep -nE "NewsletterForm|dealAlerts|No spam" "src/app/[locale]/hot-deals/page.tsx"
```
Expected: **no matches** (exit 1). (`dealAlerts` prefix also matches `dealAlertsDesc`; `No spam` catches a leftover subtitle line. Verified these tokens exist ONLY in the removed card on the post-#8 file.)

- [ ] **Step 4: Build + lint** — `npm run build` succeeds (no unused-import / no missing-symbol errors); `npm run lint` no new errors.

- [ ] **Step 5: E2E** — full suite green; if a test asserts the Deal-Alerts card on `/hot-deals`, update/remove that assertion and flag.

- [ ] **Step 6: Commit** (can be one commit with Task 1, or separate)

```bash
git add "src/app/[locale]/hot-deals/page.tsx"
git commit -m "fix(honesty): remove non-functional /hot-deals deal-alerts email capture (no sender, no worker)"
```

> ⚠ **Jose visual review before deploy** — this drops a visible card from `/hot-deals`. Part of the standing no-deploy-without-review gate.

---

### Task 3: Remove the `ArticleHero` "Weekly price drops" Deal-Alerts card (item ②)

**Base:** current `main` for `ArticleHero.tsx` (neither #7/#8 touch it, verified); **post-#7+#8 merged tree** for `help-content.ts` (both PRs edit it).
**Files:** Modify `src/components/ArticleHero.tsx` AND `src/lib/help-content.ts`.

**⚠ help-content coupling (Fable Blocker):** removing the hero card WITHOUT removing its help entry leaves every article's Help button describing a form that no longer exists (violates [[feedback_update_help_with_features]]). So this task also deletes the `"Deal Alerts sidebar"` object from the `"article"` pageId section of `src/lib/help-content.ts`. The exact line (heading string is **unique** in the file — identify by content, NOT line number; #7→66/#8→65 and the merge may shift again):
```ts
      { heading: "Deal Alerts sidebar", text: "Enter your email in the hero section to get weekly price drop alerts on flights, hotels, and cruises." },
```
Leave `:56` (preferences toggle — that feature is retained) and `:17` (account benefits) — those are legitimately deferred.

**Remove this entire right-column block** (lines ~71–80):
```jsx
          {/* Right — Deal Alerts, aligned with sidebar column */}
          <div className="hidden lg:flex items-end">
            <div className="w-full bg-white/10 backdrop-blur-md rounded-xl p-5 border border-white/20">
              <p className="text-sm font-bold text-white">Deal Alerts</p>
              <p className="text-xs text-white/70 mt-1 mb-3">
                Weekly price drops on flights, hotels &amp; cruises.
              </p>
              <NewsletterForm source="hero" />
            </div>
          </div>
```
**Remove the now-unused import** (line 3): `import NewsletterForm from "@/components/NewsletterForm";` (only the one usage — verify with guard).
**Collapse the parent grid** — the wrapper (line ~39) reserves a 360px right column for that card:
```jsx
        <div className="w-full grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
```
Change to a single-column wrapper so the article text doesn't leave an empty 360px gap:
```jsx
        <div className="w-full">
```
(The left child is already `max-w-2xl`, so it stays constrained.)

- [ ] **Step 1: Confirm the block/import/grid + help entry exist**

```bash
grep -nE "Right — Deal Alerts|source=\"hero\"|grid-cols-\[1fr_360px\]" src/components/ArticleHero.tsx
grep -Fn "Deal Alerts sidebar" src/lib/help-content.ts
```
Expected: first grep all three present; second present exactly once.

- [ ] **Step 2: Remove the card block + import; change the grid wrapper to `w-full`; delete the `"Deal Alerts sidebar"` object from `help-content.ts` (by heading content).**

- [ ] **Step 3: Guard**

```bash
grep -nE "NewsletterForm|Weekly price drops|Deal Alerts|1fr_360px" src/components/ArticleHero.tsx   # expect none
grep -Fn "Deal Alerts sidebar" src/lib/help-content.ts                                                # expect none
```
Expected: **no matches** in either (exit 1).

- [ ] **Step 4: Build + lint** — `npm run build` (no unused-import error) + `npm run lint` (no new errors).

- [ ] **Step 5: E2E** — full suite green. **No article-hero visual baseline exists** (`tests/e2e/visual-baseline.spec.ts` snapshots only `planner/[tripId]`) — nothing to regenerate. Jose visual-reviews the reflowed hero manually before deploy.

- [ ] **Step 6: Commit**

```bash
git add src/components/ArticleHero.tsx src/lib/help-content.ts
git commit -m "fix(honesty): remove non-functional 'weekly price drops' capture from article hero"
```

> ⚠ **Jose visual review** — changes every article hero (drops the right card, article text now full-width). No deploy without review.

---

## Self-Review (REV 5)
- **Fable REV-4 review folded (2026-07-17):** Blocker — Task 3 now also deletes the `"Deal Alerts sidebar"` help entry (else the article Help button describes a removed form; [[feedback_update_help_with_features]]). Task 2 guard tightened (`No spam`/`dealAlerts`). Title/architecture de-staled ("pure content edit" was false once Tasks 2/3 touch TSX). ✔
- **Fable-verified byte-exact:** Task 2 block vs #8's `hot-deals/page.tsx` (zero delta), Task 3 block vs main `ArticleHero.tsx` (zero delta); no orphaned wrappers; grid collapse build-safe; catalog-key retention won't trip #8's i18n/fabrication guards; **no tests break**. ✔
- **Spec coverage:** all 3 ❌ keys × 6 locales tabled with exact FROM+TO; help-content dropped (→#8); item-② lines routed out. ✔
- **Placeholder scan:** all 18 FROM + 18 TO verbatim. ✔
- **Guard soundness (was Blocker 1):** exact `grep -F` on all 18 OLD strings per Step 3 — no regex/locale gaps. ✔
- **No invented claims (was Blocker 2):** `dontSeeDesc` TO now matches the two real buttons. ✔
- **#8 collision (was Blocker 3):** base rebased; help-content edit removed. ✔
- **subheading@332 (Should-fix 2):** explicitly out of scope. ✔
- **Task 2 (REV 3):** guest-hero removal specified against the **post-#8** file (verified block + import exist on that branch); NewsletterForm's other-page usages left intact; broader newsletter-no-sender issue routed to follow-up, not scope-crept. ✔
- **Task 3 (REV 4):** ArticleHero card removal — base = main (neither #7/#8 touch it, verified); exact block + import + parent-grid collapse specified; visual reflow flagged for Jose review; guides/LatestGuides newsletter forms deliberately excluded per Jose. ✔

## Execution note (routing)
Hermes GPT-5.5 implements tonight (post-merge); Fable verifies (translations natural + guards catch every locale); Opus orchestrates. Written to be mechanical.
