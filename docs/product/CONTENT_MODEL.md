# TPI Content Model

Status: Canonical article JSON contract and rendering model for TravelPlanInfo.

Sources: `src/lib/articles.ts`, `src/app/[locale]/[slug]/page.tsx`, `src/config/affiliates.ts`, current `content/articles/*.json`, Fable 5 diagnosis section 8, and D6/D7.

## Model overview

TPI articles are JSON files in `content/articles/`. The app treats each file as one article record and reads it synchronously from the filesystem at runtime/build time.

Loader:
- `ARTICLES_DIR = path.join(process.cwd(), "content", "articles")` (`src/lib/articles.ts:25`).
- `getAllArticles()` reads all `.json` files and sorts descending by `date` (`src/lib/articles.ts:27-40`).
- `getArticle(slug)` resolves `${slug}.json` under the articles directory and rejects path traversal (`src/lib/articles.ts:43-55`).

Rendering:
- Article body is one WordPress-style HTML blob in `content`.
- The template strips the H1, splits on H2, renders each section with `dangerouslySetInnerHTML`, and injects `ArticleAffiliateCTA` after every second H2 section except the first (`src/app/[locale]/[slug]/page.tsx:18-24`, `:215-223`).
- FAQ accordion and FAQ schema render when `faq` exists (`src/app/[locale]/[slug]/page.tsx:136-164`, `:230-232`).
- Sticky sidebar affiliate banners render through `AffiliateSidebar` (`src/app/[locale]/[slug]/page.tsx:244-247`).

## Field-by-field spec

| Field | Status | Type | Rule |
|---|---|---|---|
| `slug` | Required | string | Must match filename without `.json`; used for route and canonical URL. |
| `title` | Required | string | Article H1/title. Content blob may include H1, but renderer strips it before body sections. |
| `excerpt` | Required | string | Fallback description and guide cards. Must be human-written, not keyword stuffing. |
| `content` | Required | HTML string | Sanitized/trusted pipeline output. Must contain one H1 and multiple H2 sections for CTA injection. |
| `featuredImage` | Required nullable | string or null | Used by `ArticleHero` and schema image when present. Must be local `/images/articles/...` or approved absolute URL. |
| `categories` | Required | array `{name, slug}` | First category currently drives breadcrumb/category and CTA fallback. Slug should not contain punctuation artifacts such as comma unless intentionally supported. |
| `date` | Required | ISO string | Publish date. |
| `modified` | Required | ISO string | Last modified date; sitemap uses this for articles. |
| `seo.title` | Required | string | Metadata title. |
| `seo.description` | Required | string | Metadata description and Article schema description. |
| `seo.canonical` | Required for English | URL string | English canonical URL. Non-English pages canonicalize to English under D5. |
| `seo.ogImage` | Strongly recommended | URL string | OpenGraph image. Should match featured image when possible. |
| `affiliateOpportunities` | Required | string[] | Drives in-body CTA selection. Values must map to supported affiliate surfaces; no unknown partner names. |
| `search_location` | Required going forward | string | Destination/search phrase for CTA prefill and partner handoff. Currently optional in TypeScript and absent in corpus per diagnosis; D6 says fix rather than delete. |
| `faq` | Required for destination guides | array `{question, answer}` | Used for FAQ accordion and FAQPage schema. Current corpus has FAQ on all 59 articles per diagnosis. |
| `schemaType` | Required going forward | enum | Must be one of `destination_guide`, `how_to`, `comparison`, `hotel_review`; renderer must wire it safely before other migrations inherit it. |
| `sections` | Not part of current app contract | n/a | Pipeline may have a sections-JSON source model, but the app currently consumes only the HTML blob. Do not document `sections` as app input until code supports it. |
| `in_body_ctas` | Pipeline-side control, not app field | boolean | TPI app currently injects CTAs from `affiliateOpportunities`; pipeline should not also bake duplicate CTAs into `content`. |

## Required article shape example

Current sample article evidence:
- `content/articles/key-west-florida-vacation-guide.json` includes `slug`, `title`, `excerpt`, HTML `content`, `featuredImage`, `categories`, `date`, `modified`, `seo`, `affiliateOpportunities`, `schemaType`, and `faq`.
- `content/articles/asheville-north-carolina-vacation-guide.json` follows the same shape.

Gap to close:
- `search_location` is declared in `src/lib/articles.ts:20` but not present in the inspected sample files and was counted as 0/59 by the diagnosis. New articles must include it; existing articles need backfill.

## Rendering pipeline

1. Read article JSON with `getArticle(slug)`.
2. Generate metadata from `seo` and route locale.
3. Render Article schema, Breadcrumb schema, and FAQ schema when present.
4. Render hero from `featuredImage`, title, excerpt, date, and first category.
5. Strip H1 from `content`.
6. Split body by H2.
7. Render each section.
8. If `affiliateOpportunities.length > 0`, inject `ArticleAffiliateCTA` after every second section where `i > 0 && i % 2 === 0`.
9. Pass CTA destination as `post.search_location || post.categories?.[0]?.name`.
10. Render `AffiliateInlineCTA`, FAQ accordion, and sticky sidebar.

Rules:
- Content must not include unvalidated scripts or third-party embeds unless the renderer explicitly supports them.
- Content should not contain duplicate in-body affiliate blocks if the app will inject CTAs.
- H2 structure matters; articles with too few H2s get fewer CTA insertion opportunities.

## Affiliate partner model

D7 locks one partner set for articles, Atlas links, and planner sidebar: Klook, Tiqets, Kiwi.com, Kiwitaxi plus CJ, implemented through `src/config/affiliates.ts` or its successor.

Current code evidence:
- CJ links for Hotels.com, Vrbo, CruiseDirect, EconomyBookings, and AirAdvisor TODO (`src/config/affiliates.ts:5-32`).
- Aviasales/Travelpayouts marker `164743` (`src/config/affiliates.ts:34-41`).
- Klook tp.media link builder (`src/config/affiliates.ts:43-49`).
- Deal and sidebar banner catalogs (`src/config/affiliates.ts:51-213`).

Implementation consequence:
- `affiliateOpportunities` values must map to this config layer.
- Tiqets, Kiwi.com, and Kiwitaxi are absent from `src/config/affiliates.ts` today, so Phase 3 must add them to the config before using them in articles/Atlas/planner.
- Do not add article-level hardcoded affiliate links outside the config unless the config is missing a required program and the same change adds that program.

## Relationship to Article Factory

Article Factory maintainers must validate that queued TPI articles conform to this contract before publishing.

Required pre-publish checks:
- JSON parses.
- Filename equals `slug + ".json"`.
- Required fields are present and non-empty.
- `content` includes H1 and at least enough H2s for planned CTA insertion.
- `seo.title`, `seo.description`, and English canonical are present.
- `featuredImage` path exists or is intentionally null with a fallback plan.
- `affiliateOpportunities` entries are supported.
- `search_location` exists and is a useful human search phrase.
- `schemaType` exists and is valid.
- `faq` exists for destination guides and has non-empty Q/A pairs.
- Event/date claims are source-validated before publishing under the broader content pipeline rule.

## Validation checklist for new articles

Before commit/deploy:
- `node`/script JSON parse passes for the new file.
- Article route returns 200 locally.
- Metadata title/description/canonical render as expected.
- FAQ schema validates if `faq` is present.
- In-body CTA appears in expected positions and destination prefill uses `search_location`.
- Affiliate links use `rel="sponsored"` where applicable.
- Images load from the expected local path.
- Sitemap includes the English URL and locale variants according to `SEO_MIGRATION_STRATEGY.md`.

## Dead or underwired fields

Not dead, but underwired:
- `schemaType`: keep and wire because TPI is the reference implementation (D6).
- `search_location`: keep and backfill because Article Factory/TPI CTA strategy expects it.

Not app contract yet:
- `sections`: do not require until renderer supports sections JSON.
- `in_body_ctas`: pipeline-side only; not a rendered app field today.

Acceptance criteria:
- `wp-publish-validator` / `tpi_publisher` checks match this file.
- Existing corpus is backfilled for `search_location` and validated `schemaType` before TPI's model is generalized to other sites.
