# TravelPlanInfo North Star

Status: Canonical product direction for TravelPlanInfo (TPI) and Atlas, reordered 2026-10-20 under D11. Supersedes the older memory-doc fragments listed at the end of this file, including `tpi-mission.md`.

Source basis:
- North-star decision and Jose's calls of 2026-10-20: `docs/superpowers/specs/2026-10-20-tpi-consolidation-and-north-star-design.md` (§2 north star, §8 calls, §9 decisions)
- Decisions D1-D13: `docs/DECISIONS.md` — D1-D10 seeded from the resolved-decisions handoff below, D11-D13 appended 2026-10-20
- Fable 5 diagnosis: `/home/jarvis/.openclaw/workspace/jarvis-project/docs/superpowers/handoffs/2026-07-04-fable5-tpi-atlas-diagnosis.md`
- Resolved decisions D1-D10: `/home/jarvis/.openclaw/workspace/jarvis-project/docs/superpowers/handoffs/2026-07-05-tpi-atlas-decisions-RESOLVED.md`
- Current TPI code: `main` (the 2026-10-20 spec's recon basis)

## One-sentence north star

*Planner-first in purpose, guides-first in what gets fixed now:* TravelPlanInfo is a fast, English-first travel site where Atlas and the planner are the product, destination guides are the doorway into that product, and agent distribution in ChatGPT/Claude comes later — so travel intent turns into truthful affiliate-booking actions that demonstrably work on `travelplaninfo.com`.

## Product thesis

TPI has three layers, in this order (D11, 2026-10-20):

1. Atlas + the planner are the product. A tool people actually use is the one thing AI search cannot replace. Guest-friendly trip CRUD, Path A itinerary planning, and Path B Surprise Me make the site a tool, not a blog, and the planner is the retention surface plus the migration pattern for other owned properties (D6). The foundation and precedent for all planner work already shipped: Phase 0, PR #3, added `/api/assistant/health` and hides Atlas's proactive invitations when the backend is unreachable (D1). The Atlas brain runs inside the Next.js app on the VPS — never `command-post`, never a workstation dependency (D2).
2. Guides are the doorway into the product. Each guide carries fewer generic words and more checked, dated facts — citable fact blocks with a "last verified" date — so AI answers cite the guide instead of answering without a click. Every guide also carries a "Plan this trip" bridge into Atlas/planner, qualified by destination kind: place and region guides get a bridge pre-filled with the guide's destination, while planning-tips, multi-destination, and world-list guides (destination kind "none") get no destination CTAs and an un-prefilled generic "Plan a trip" bridge. Guides remain the live traffic and affiliate-revenue source today and keep their publishing cadence (D8): the content model is JSON articles rendered by the Next.js app (`src/lib/articles.ts`) with in-body CTA injection in the article template (`src/app/[locale]/[slug]/page.tsx`).
3. Agent distribution, later (WS-D). Atlas becomes callable from inside ChatGPT and Claude through MCP (`plan_trip`, `search_flights`, `build_itinerary`), carrying TPI's affiliate links through every tool result. It is sequenced after the planner and doorway work, not before it.

What changed vs the 2026-07-05 thesis: the ordering inverts. Guides are no longer "the product floor" — the planner is the product and guides feed it. Sequencing still starts on the guide surface, because that is where today's traffic and money leaks sit (CTAs searching bucket names, ~330 duplicate non-English pages, zero flight CTAs, no bridge into the planner — WS-B fixes those first).

## Personas

Primary persona:
- US-origin leisure traveler, often arriving from a destination guide doorway, planning a trip 2 weeks to 6 months out.
- Current product evidence: MIA defaults, US destination-guide corpus, Travelpayouts/Aviasales flight links, CJ and activity partners, and guide-to-planner CTA paths.

Secondary personas:
- Returning traveler who wants TPI/Atlas to remember preferences across sessions.
- Jose / operator: needs a deployable, verifiable reference implementation for future WordPress-to-Next.js migrations (D6).
- Article Factory maintainer: needs a stable article JSON contract and validation rules that match what the site actually renders.

## Jobs to be done

1. Help me turn intent into a dated, priced plan.
   - Served by TripForm, Trip pages, manual itinerary CRUD, and Atlas running from the Next.js-deployed brain (D2).
2. Tell me what this destination is like and what it costs.
   - Served by guide articles as the doorway: fewer generic words, citable fact blocks, FAQ schema, affiliate CTAs, partner search links, and the pre-filled "Plan this trip" bridge into the planner.
3. Find cheap routes/deals from my airport.
   - Served by real Travelpayouts/Aviasales data, not invented prices.
4. Help me evaluate lodging, activities, and restaurants honestly.
   - Served by prose guidance plus partner-search handoffs under D3; Atlas must not invent specific hotel/activity/restaurant inventory or prices.
5. Remember me so I do not restart every trip.
   - Served by registered-user memory (`user_memory`) and guest-to-registered conversion. Guests may chat, but memory remains session-only until registration (D4 plus historical two-tier memory decision, H5).

## Revenue mechanism

TPI earns through affiliate commissions, not ads or subscriptions at this stage.

One partner set governs articles, Atlas tool links, and the planner sidebar (D7, as amended by D13). The affiliate order, verified against Jose's CJ export on 2026-10-20:

1. **Hotels** — CJ Hotels.com, advertiser `1702763`, evergreen deep-link `15734399`, verified active 2026-10-20 (3-month EPC $112.27, kept — the "retired link" claim was wrong).
2. **Flights + Klook** — Travelpayouts/Aviasales, marker `164743`. Flight CTAs use a real per-article IATA code, never the first three letters of the city name.
3. **AirAdvisor** — CJ advertiser `7818110`, text link `17238636`, tagged — replacing the untagged URL.
4. **Tiqets, Kiwi.com, Kiwitaxi** — planned in the WS-C Atlas-upgrade workstream; not yet configured.

D13 supersedes the D7 wording that made `src/config/affiliates.ts` the governing source of truth: the partner truth is this order plus `docs/DECISIONS.md`, and the existing config (CJ links, Travelpayouts marker, Klook via tp.media) reconciles toward it through WS-B/WS-C work.

The MVP success metric is affiliate clicks per trip session, measured through GA4 click events carrying partner, slug, placement, and trip session id (D13, amending D10) — no partner sub-IDs this round, revenue per guide stays inferred rather than attributed, and GSC plus lightweight analytics remain supplementary (D10), not deferred to Phase 4.

## MVP definition

The planner works when this journey is true on production, on a phone, with Jose's workstation off:

1. Guest lands on a destination guide — the doorway.
2. Guest follows the guide's pre-filled "Plan this trip" bridge (or opens the planner directly) and creates a trip.
3. Guest sees Atlas only when health permits; proactive UI remains hidden if `/api/assistant/health` is unhealthy.
4. Guest consents to Atlas search.
5. Atlas streams a response from the Next.js-deployed brain and returns at least one real flight/deal card from Travelpayouts/Aviasales.
6. Atlas gives lodging/activity/restaurant guidance through D3 partner-search handoffs, with no invented specific entity names or prices.
7. Guest can add relevant items to the itinerary.
8. Guest clicks a working affiliate link from the D13 partner order: CJ Hotels.com for hotels, Travelpayouts for flights and Klook, AirAdvisor as configured, and Tiqets/Kiwi/Kiwitaxi once configured.
9. The click is recorded as a GA4 affiliate-click event carrying partner, slug, placement, and trip session id (D13), alongside session spend and health evidence.

## Non-goals

- Atlas as a standalone product.
- Atlas as an SEO content generator.
- Atlas depending on `command-post`, Jose's workstation, Tailscale, tunnels, or any machine that sleeps.
- Fabricated hotel/restaurant/activity inventory or prices — the no-fabrication guard stays the durable invariant.
- Multi-locale content expansion before real translations exist. Next-intl UI infrastructure stays and non-article pages (home, planner, help) keep their locales and hreflang; but under D5 as amended by D12, every non-English article route 301-redirects to the English URL and drops out of the sitemap and article hreflang.
- Merging TPI with travelsfy (M39 is separate).
- In-chat checkout or booking, paid subscriptions for TPI, and B2B white-label for tourism boards this round (2026-10-20 spec §3 non-goals).
- Collaboration, consensus voting, cost-splitting, Tailwind 4 / TS 6 / ESLint 10 stack loops, and quiz-column cleanup before the production Atlas/planner loop works.
- Changing the Article Factory cadence while the planner work happens (D8). Note: publishing has been paused since 2026-09-13 with the schedule timer disabled pending the factory remediation; WS-B fixes still apply to all 66 existing articles.

## Success metrics

Hard MVP metrics:
- Production Atlas health endpoint returns healthy after the in-app brain migration.
- A guest production chat returns streamed text and at least one real tool-result card.
- Affiliate clicks per trip session are measured through GA4 click events carrying partner, slug, placement, and trip session id — no partner sub-IDs this round; revenue per guide stays inferred, not attributed (D13).
- Zero Atlas responses show invented hotels/restaurants/activities or invented prices.
- GSC and lightweight analytics are set up alongside Phase 0-3 work (D10) and remain supplementary to the GA4 click metric.

Operating metrics:
- Article publishing cadence continues without regression once the factory remediation lands.
- Sitemap/canonical behavior matches `SEO_MIGRATION_STRATEGY.md` and the D12 route-level 301 rule.
- Deploy verification includes production gates, not only local lint/build/E2E, and nothing ships without Jose's visual review.
- Spend remains under the $10/month Atlas cap until Jose changes it (D4).

## Supersedes list

This doc is the product authority over older memory/spec fragments when they conflict. Historical context remains useful, but future agents should cite this file plus `ATLAS_PRODUCT_SPEC.md` and `docs/DECISIONS.md` (now D1-D13).

Superseded as canonical authority:
- `tpi-mission.md` — SUPERSEDED 2026-10-20 by this file. Its planner-as-the-product intent is kept and completed by D11 (planner-first in purpose, guides-first in what gets fixed now); a supersession banner stands at the top of that memory doc.
- `tpi-atlas-product-flow.md` where it conflicts with the permanent static help fallback (H7).
- `tpi-atlas-memory-system.md` where it is incomplete without D4, H5, and the current SQLite implementation.
- `tpi-auto-results-on-trip-create.md` where it implies automatic Atlas network work without consent (H4).
- Older affiliate-priority notes from Mar 19 / Mar 21 that conflict with D7 as amended by D13.
- Older i18n/SEO assumptions that conflict with D5 as amended by D12.

## Mission filter for future work

Reject or defer any task that fails one of these checks:
- Does it make Atlas or the planner more useful, more truthful, more deployable, or more measurable on production?
- Does it improve guide-to-planner-to-affiliate conversion — the doorway doing its job into the product?
- Does it preserve the guide traffic and affiliate revenue that fund the work while the product is built out?
- Does it avoid workstation runtime dependency?
- Does it align with D1-D13 in `docs/DECISIONS.md` (D11-D13 appended 2026-10-20)?