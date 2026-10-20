# TPI Consolidation, North-Star Realignment & AI-Era Roadmap — Design

**Date:** 2026-10-20 · **Status:** DRAFT, awaiting Jose's approval · **Repo:** travelplaninfo (`main` @ `d9cdcd6`)
**Supersedes on approval:** the "Product thesis" ordering in `docs/product/NORTH_STAR.md` (2026-07-05) and `tpi-mission.md`.

## 1. Intent — why now

LLMs are now much smarter than when TPI and Atlas were built, and the travel market has moved under the site at the same time. Google AI Mode now plans trips, tracks fares and books hotels inside search. ChatGPT runs Expedia, Booking and Tripadvisor apps and sells travel ads. Generic "things to do in X" guides are what AI Overviews answer without sending a click (Tripadvisor now expects SEO to be <10% of Experiences bookings by end-2026).

Jose also wants a **clean workspace**: it has been too long since the old branches were touched to remember what is what.

Success, per Jose: **all of** more traffic, more affiliate revenue, a cleaner codebase, and a clear roadmap.

## 2. North-star decision (Jose, 2026-10-20)

> **Planner-first in purpose, guides-first in what gets fixed now.**

- **Atlas + the planner are the product.** A tool people use is the one thing AI search can't replace.
- **Guides are the doorway.** Each guide carries fewer generic words and more checked, dated facts, so AI answers cite it. It also carries a pre-filled "Plan this trip" bridge into Atlas.
- **Distribution follows users.** Later, Atlas becomes callable from inside ChatGPT and Claude, carrying TPI's affiliate links.

This resolves the conflict between the two docs: `tpi-mission.md` puts the planner first, while `NORTH_STAR.md` puts content first as "the floor". Once this spec is approved, `NORTH_STAR.md` gets rewritten (see WS-0).

## 3. Goals, non-goals, anti-goals

**Goals**
- One clean `main`. Every branch is merged, salvaged or deleted, with a recorded reason.
- Close the money leaks on the guide pages that already get traffic.
- Make revenue measurable, through affiliate click tracking per guide and per trip session.
- Rebuild Atlas around current-model capability instead of older-model workarounds.
- Have a staged path to agent distribution (MCP in ChatGPT and Claude).

**Non-goals (this round)**
- In-chat checkout or booking (Mindtrip needed Sabre + PayPal to do it).
- Paid subscriptions for TPI.
- B2B white-label for tourism boards.
- Merging TPI with travelsfy (M39 is separate).

**Anti-goals: these count as failure even if the code works**
- Atlas invents prices, availability or links. The no-fabrication guard stays the durable invariant (M28/M29).
- More generic guides pumped out at volume. That feeds the channel AI is eating.
- Anything ships to the VPS without Jose's visual review.
- Merging the deploy-safety branch without its jarvis-project sibling, or the other way round.

## 4. Evidence base (recon, 2026-10-19)

Recon was read-only. These are the findings the workstreams rely on.

**Guide-page leaks (`main`)**
1. **CTA destinations are wrong.** In `[slug]/page.tsx:222` the destination falls back to `categories[0].name`, because `search_location` is empty on all 66 articles. On 36 articles that fallback is a bucket name like "Destinations", so the Hotels.com and Klook CTAs search for that word.
2. **One hotel link carries every hotel CTA.** It is CJ link id `15734399`, which is no longer in the CJ catalog (backlog ~l.380).
3. **~330 duplicate pages.** The non-English pages are English copies that each declare themselves canonical, with hreflang pointing between them (`[slug]/page.tsx:86`, `sitemap.ts:36-48`). Decision D5 (canonical to English) was never implemented.
4. **No affiliate-click event exists anywhere.** D10's metric can't be measured.
5. **Flights are absent from the guides.** 0 of 66 articles have a flights CTA. `TP_CONFIG.searchUrl` turns a city name into its first 3 letters (`affiliates.ts:38`, so "Napa" becomes "NAP"), which means it isn't a valid IATA lookup.
6. **No bridge into the planner.** 0 of 66 articles link to `/planner`. On article pages Atlas gets no destination, because a regex in `system-prompt.ts:43-65` fails to match titles, and it is told to give no partner links.
7. **Smaller leaks.** AirAdvisor is an untagged URL (`affiliates.ts:29-31`). `AffiliateSidebar` always shows Miami deals.

**Atlas (`main`)**
- **Model and call.** Atlas runs `claude-sonnet-5` with `thinking: disabled` (`tool-loop.ts:16,204`). Calls are non-streaming. The reply is fake-streamed word by word with a 10ms sleep (`:152`), and tools run sequentially (`:226`).
- **Limits.** Replies are capped at 150 words (`system-prompt.ts:99`). The nearby-airport map is hardcoded with 10 entries.
- **Tools.** `search_flights`, `get_deals`, `get_article` and `surprise_me`. The only inventory is Travelpayouts `prices_for_dates`. Hotels and activities get prose plus one search link, and there is no car, transfer or activity inventory.
- **Memory is suspect.** `user_memory` is read (`chat/route.ts:90-115`). Summarize is called fire-and-forget only for signed-in users whose earlier session has ≥6 messages (`chat/route.ts:142-157`), and guests are skipped. The audit's "never written" claim was wrong. The open question is whether prod `user_memory` has any rows; WS-C debugs it.
- **Spend cap is under-counting.** The cap is $10/mo, priced at "introductory" rates that expired 2026-08-31 (`spend.ts:3-21`).
- **Two model generations.** Summaries still use `claude-sonnet-4-6`.

**Content**
- 66 articles, English only, median length about 3,650 words. None have `search_location`; 17 have a `schemaType`.
- Nothing has been published since 2026-09-13. The schedule timer is disabled, pending the factory remediation.

**Competitor openings, ranked.** Full table: recon transcript summary in §10.
1. Fact blocks AI answers can cite.
2. Atlas as an MCP app (only community-built Travelpayouts MCPs exist).
3. Make Atlas work reliably in production.
4. Guide → "plan this trip".
5. Live price reasoning ("fly Tue, save $140").
6. Niche constraint planning (multi-city, kids, accessibility, layovers).
7. Activities and transfers affiliates per itinerary day (Klook/Tiqets/Kiwitaxi).
8. Paste a link or photo → itinerary.
9. Price-drop and disruption alerts.
10. Real localization.

## 5. Workstreams

These are separate projects. **Each gets its own plan** via `superpowers:writing-plans` and runs the full Ralph Loop under Model Routing. WS-A runs alongside the others (Jose: "the branch cleanup runs alongside all of it").

### WS-0 — Rewrite the north-star doc (S, docs only)
Rewrite `docs/product/NORTH_STAR.md` to §2's ordering. Fold in D1–D10 where they still hold, and mark `tpi-mission.md` superseded. Reconcile the affiliate-network order: per the code and D3, CJ Hotels.com is primary for hotels, and Travelpayouts covers flights and Klook.

### WS-A — Branch consolidation (runs alongside everything)

| Item | Action | Reason |
|---|---|---|
| `feature/three-mode-entry-system` (+19, Mar) | **Delete** | Squash-merged as `bcb2cd5` (2026-04-09). Parts were deliberately removed later (`5902879`, `6500cee`). Merging would conflict in 13 files. |
| `origin/tpi-design-gemini` | **Delete** | February A/B/C prototype, replaced by Design A. |
| 4 local + 4 remote fully-merged branches | **Delete** (local + remote) | `git branch -a --merged main` |
| `docs/2026-07-07-banked-plans` (+2) | **Salvage** the 12 `docs/superpowers/**` files onto `main`, then delete | It is the only copy, never pushed. It holds the Phase 2A GSC, Phase 3 monetization, factory-MCP and Tailwind-4 spec/plan sets, which feed WS-B/WS-C. Its `.gitignore` commit is already on main. |
| `origin/brand/favicons-2026-08-26` | **Salvage** the icon assets and re-wire `layout.tsx` by hand | Conflicts in 4 files. The favicon.svg already on main needs a comparison first. |
| `tpi-help-and-queued-content` (+5) + jarvis-project `tpi-deploy-safety` (+14) | **Fix the 10 review findings on the branch, then merge both together** | The pair depends on each other: `content/queued/` and the runner. The help branch merges with no conflicts. Deploy-safety conflicts only in `command-post/tests/test_content_assembler.py`, and main is 54 commits ahead, so re-run the tests after merging. The rollout stays on HOLD until Jose says otherwise. |
| Clutter | Remove `.next/`, `playwright-report/`, `test-results/`, `.ruff_cache/`. Remove the help worktree after the merge (2.7 GB). | Regenerable. Keep `data/tpi.db`. |
| Out of scope, noted | jarvis-project `sprints-page` worktree, 3 detached kilo worktrees | Separate cleanup. |

**Review findings to fix before the merge**, from the 2026-10-19 `/code-review medium`:
- (1) Unpriced flights save `price_estimate: "—"` (`TripResultsModal.tsx:200,214`). The test only checks `description`.
- (2) A duration of 0 or unparseable becomes 0 min instead of `DURATION_UNKNOWN` (`AssistantChat.tsx:173`).
- (3) A single flight search no longer shows inline FlightCards (`AssistantChat.tsx:1000`).
- (4) The modal focus trap re-runs on every parent render, because of an inline `onClose`.
- (5) `extractTripData` runs per message on every render.
- (6) Dead min/max range code.
- (7) A lib module imports from the components folder (`NO_PRICE_LABEL`).
- (8) Help copy says Atlas never searches by itself, which contradicts the smart-search chip.
- (9) The help-copy guard regex is easy to evade. It needs an allowlist so unknown claims fail closed.
- (10) A source-text-counting tripwire should be replaced with a behavioral test.

**Note on deleting branches:** deleting remote branches is outward-facing and can't be undone. The plan lists every ref, and Jose approves that list before any `git push --delete`.

### WS-B — Guide revenue leaks (do first, in this order — Jose)

**Article destination model** (applies to B1, B2 and B4). Each article gets a `destination` block with one of three shapes:
- `{kind:"place", search_location, destination_iata}` for single-destination guides.
- `{kind:"region", search_location}` for guides like Florida or Hawaii. These get hotel and activity CTAs with the region name, and no flight CTA unless one gateway IATA is set.
- `{kind:"none"}` for planning-tips, multi-destination and world-list guides. These get no destination CTAs. Their "Plan this trip" bridge opens the planner un-prefilled, as "Plan a trip".

The fields live in the **draft JSON** and pass through `tpi_publisher.py` into `content/articles/{slug}.json`, so a republish keeps them. The one-time backfill of the 66 live articles:
- writes both the draft and the live JSON;
- is model-proposed and then reviewed in one sheet by Jose;
- bumps `modified` and re-runs `content_reviewer` and the slug gates.

The publisher change is coordinated with the factory remediation, which is touching the same files.

1. **Fix the hotel and activity CTAs.**
   - Backfill `search_location` on all 66 articles. Derive it from the article's place, not the category, and have the model propose it from the title and body for review.
   - Make the CTA refuse to render when there's no real location, rather than searching for a bucket name.
   - ~~Replace the retired CJ link `15734399`.~~ Dropped 2026-10-20: the link is active (§9.3).
2. **Add flight buttons and click tracking.**
   - Add an Aviasales CTA using a real IATA code: an explicit `destination_iata` per article, or a proper airport lookup. Never the first 3 letters of the city.
   - Emit an affiliate-click event (partner, article slug, placement, trip session id if any) to GA4 so D10's metric becomes measurable.
3. **Kill or redirect the duplicate non-English pages.**
   - **Every** `/{es,pt,fr,de,it}/{article-slug}/` route 301s to `/{article-slug}/`. This is a route-level rule, so it also covers future articles. Their bodies are English wrapped in translated chrome. Drop those URLs from the sitemap and article hreflang.
   - Non-article pages (home, planner, help) keep their locales and hreflang.
   - The 301s compose with `slug-redirects.ts`: an old slug resolves first, then the locale redirect, so there are no redirect chains longer than 2.
4. **Add a "Plan this trip" bridge on every guide.**
   - A prominent CTA opens Atlas or the planner pre-filled with the guide's destination (from `search_location`), with an optional dates prompt.
   - Pass the article's destination and slug as structured page context instead of the title regex.
   - Atlas then gives partner links on article pages.

Also in scope, small: tag AirAdvisor through CJ, and make the sidebar deals destination-aware.

### WS-C — Atlas upgrade (then)
- **Reasoning and real streaming.** Turn thinking on (adaptive) with real token streaming to the client. Remove the 150-word cap and the fake word-split stream. Run independent tools in parallel.
- **Context instead of regex.** Atlas gets structured context: the article, the trip, saved preferences. Drop the title regex. Replace the hardcoded nearby-airport map with a data-backed lookup.
- **Memory that works.** Check prod `user_memory`. If it's empty, debug the summarize call (base URL, cookie forwarding). Whether guests get memory is a product call for the WS-C brainstorm.
- **One brain.** Confirm whether the FastAPI brain (`command-post/routers/assistant.py`, its own $10 cap) is still live. Per D2 the brain lives in Next.js, so retire the duplicate, or the re-pricing and model changes have to be made in both codebases.
- **Inventory reality check.** At the start of WS-C, list which programs give real API or feed access (CJ product feeds, Klook, Kiwitaxi, Tiqets), as opposed to link-level approval only. Only those can become live-price tools.
- **Live prices across verticals.** Today only flights are live. Add real inventory or price endpoints where TPI holds programs (hotels via CJ or Travelpayouts, Klook activities, Kiwitaxi transfers per D7) as tools. Each tool returns verbatim partner links, so the no-fabrication guard extends to every vertical rather than being loosened.
- **Price reasoning.** Use Travelpayouts calendar and month-matrix data so Atlas can explain cheaper dates and when to book.
- **Housekeeping.**
  - Put every Atlas model on one current-generation ID, named by tier per `feedback_no_version_pin_model_roles`.
  - Re-price `spend.ts` to current rates and revisit the $10/mo cap (Jose sets the new number).
  - Fold in the Phase 2A GSC plan and the Phase 3 Tiqets/Kiwi/Kiwitaxi plan salvaged in WS-A.

### WS-D — Agent distribution (later)
- An MCP server plus an MCP App UI exposing `plan_trip`, `search_flights` and `build_itinerary`, listed for Claude connectors and the ChatGPT apps directory. Results carry TPI's affiliate tags.
- Fact blocks AI answers can cite, on guides: checked prices with dates, transit times, seasonal notes, a "last verified" date, schema. These can start earlier, as a content-pipeline change.
- Candidates for after WS-D, not committed: price-drop and disruption alerts, link/photo → itinerary, real localization.

## 6. Sequencing

```
WS-0 north star ─┐
WS-A cleanup  ═══╪══════════════════════════════════════  (runs alongside)
                 └→ WS-B1 → WS-B2 → WS-B3 → WS-B4 → WS-C → WS-D
```
- WS-B items each ship and get reviewed one at a time. Each one is visible on live pages.
- WS-A's help+deploy-safety merge is independent of WS-B, but it touches the Atlas files WS-C rewrites. **Merge it before WS-C starts.**
- Publishing stays paused (timer disabled) until the factory remediation lands. WS-B fixes apply to all 66 existing articles regardless.

## 7. Constraints
- **Pipeline:** the full Ralph Loop and Model Routing apply to each workstream. GLM implements, gpt-6.1-sol⇄Sonnet consensus, Opus verifies.
- **Deploys:** no deploy without Jose's visual review. Deploy with `deploy_tpi.sh`, then purge Cloudflare. Prod SSH work goes in a `.sh` file Jose runs.
- **Slugs** stay evergreen, and redirects ship for every locale (`slug_guard.py`).
- **Guards:** guard tests must be able to go red (allowlist, fail closed), and assert on the rendered body, not just the status code.
- **Cost:** the Atlas runtime is metered Anthropic API spend. Its cap is Jose's to set.

## 8. Calls I made (check these)
- The non-English duplicates get **301 to English**, not just a canonical tag. That's what you said ("kill/redirect"), and it supersedes D5's canonical-only approach. Translated UI pages keep their locale.
- Flight CTAs need a real IATA code. I chose an explicit per-article field, backfilled and reviewed, over a heuristic.
- The CTA renders nothing when there's no location, rather than a generic search.
- The help+deploy-safety pair merges before WS-C, to avoid rewriting the same Atlas files twice.
- Fact blocks AI answers can cite sit in WS-D but may start earlier as a pipeline change.
- Branch deletions need Jose's approval of the full ref list first.
- Articles get a three-kind destination model (place / region / none). Multi-place and tips guides get a generic "Plan a trip" bridge and no destination CTAs.
- New fields live in the draft JSON and pass through the publisher. The backfill is reviewed in one sheet and re-gated.
- **All** non-English article routes 301 to English. Non-article pages keep their locales.
- Memory and FastAPI-brain questions are WS-C discovery tasks, not decided here.

## 9. Decisions from Jose (2026-10-20)
1. **The deploy-safety HOLD is lifted.** The help + deploy-safety pair merges after the 10 review fixes, before the first WS-B deploy, so WS-B ships on the safer `deploy_tpi.sh`. Each deploy still needs Jose's visual review. The schedule timer stays disabled until the factory remediation is done; that is a separate decision.
2. **Revenue measurement: GA4 click events only** (partner, slug, placement, trip session id). No partner sub-IDs this round. Revenue per guide stays inferred, not attributed. Sub-IDs are a later candidate.
3. **CJ links, verified against Jose's CJ export (2026-10-20, all Active).**
   - **Hotels.com:** evergreen `15734399` is **not retired**. It is "Evergreen Link for Hotels.com", deep-link enabled, 3-mo EPC $112.27. **Keep it.** WS-B1's "replace the retired link" item is dropped. `10772148` is not in the export.
   - **AirAdvisor:** text link `17238636` (`https://www.kqzyfj.com/click-101692716-17238636?sid=travelplaninfo`) replaces the untagged URL.

## 10. Sources
- Branch inventory, north-star audit and competitor recon: subagent reports, this session (2026-10-19).
- Prior recon: `jarvis-project/docs/research/2026-03-23-tpi-competitor-analysis.md`, `jarvis-project/docs/agentic-commerce-strategy.md`.
- Market: Skift (Mindtrip/Sabre 2026-05-06; ChatGPT ads 2026-02-09; Tripadvisor 2026-02-12; Expedia B2B MCP 2026-05-21), TechCrunch (Google AI Mode 2026-08-27), developers.booking.com (MCP server), Similarweb via LDS (travel citation rate 22.6%), ABTA (LLM referral 0.37%).
