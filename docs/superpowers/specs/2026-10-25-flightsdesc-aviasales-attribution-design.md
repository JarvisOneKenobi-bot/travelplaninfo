# flightsDesc: attribute the flight comparison to Aviasales

**Date:** 2026-10-25 · **Size:** small change (copy only, 6 locale files)

## Intent
The 2026-07-17 content-honesty audit (`docs/audits/2026-07-17-content-honesty-audit.md`, ledger row `flightsDesc`) judged
"Compare hundreds of airlines for the best fare." TRUE but unattributed: flights resolve to Aviasales, a genuine metasearch,
so the claim is honest only when it names that source. The audit's proposed text adds the attribution. It was left undone
because the follow-up PR (`2026-07-17-honest-compare-copy.md`) put `flightsDesc` out of scope ("assessed TRUE, do NOT change"
for that PR).

## Change
`flightsDesc` in `messages/{en,pt,es,fr,it,de}/common.json`, one string each, add "Aviasales":

| locale | new text |
|---|---|
| en | Compare hundreds of airlines on Aviasales for the best fare. |
| pt | Compare centenas de companhias aéreas na Aviasales pela melhor tarifa. |
| es | Compara cientos de aerolíneas en Aviasales para la mejor tarifa. |
| fr | Comparez des centaines de compagnies aériennes sur Aviasales pour le meilleur tarif. |
| it | Confronta centinaia di compagnie aeree su Aviasales per la tariffa migliore. |
| de | Hunderte Airlines auf Aviasales vergleichen für den besten Preis. |

Translations are the implementer's-call wording: each keeps the existing sentence and inserts the brand with that language's
preposition. Native-speaker review is not done.

## Non-goals
- `placeholderFlightDesc` (audit row proposes attribution too) — separate string, not requested.
- `ArticleAffiliateCTA.tsx:60` ("…airlines and agencies in one search") — different surface and string.
- Any other audit row (cars, hotels, deal alerts).

## Constraints
- Only `flightsDesc`; the key must stay in the same position in every file; JSON stays valid; no other line changes.
- Only consumer is `src/components/AffiliateRecommendations.tsx:76`; no test asserts the old text (grep verified).
- Local commit only; no push, no VPS deploy (deploy needs Jose's visual review).
