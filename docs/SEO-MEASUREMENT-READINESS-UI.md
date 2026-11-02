# Merchant-scoped SEO measurement readiness

The authenticated `/app/seo` dashboard now displays **SEO measurement readiness** in four read-only stages. This view is not the public Monika Blunder Beauty research plan. It reads **only the currently authenticated Shopify shop** and does not change product metadata, purchase Google data, start an experiment, publish drafts or import other merchants' public research.

## What the four stages actually verify

| Stage | Verified evidence | Important limitation |
|---|---|---|
| Storefront product URLs | Shopify product API sample (bounded to 100 records) with valid HTTPS `onlineStoreUrl` values | Null URLs or a failed/partial sample are not clean SEO findings; even usable URLs do not prove indexing. |
| Store-specific GSC connection | A connection row queried using `where:{shop}` and, when active, read-only Shopify Admin primary-domain attestation. The saved URL-prefix property must match the attested primary host exactly. | Connection existence and matched host **do not** establish that a page-level GSC experiment was run. |
| Page/day outcomes | **Not collected** by the current site-level GSC importer. | Existing `OrganicDailyMetric` is `shop + property + date`, not `shop + page + date`. Site totals must not be passed into product-level difference-in-differences calculations. |
| Controlled intervention | **Not recorded** in the current application. | An SEO suggestion or edited product does not establish a merchant-approved treatment/control split, timestamp, or finalized follow-up cohort. |

The status is returned by `assessSeoMeasurementReadiness` from `app/lib/seo-measurement-readiness.ts`. The function always reports `impact: "not_measured"` and `readyToEvaluate: false` because these last two evidence stages are unavailable. This conservative behavior is intentional and prevents both the lack of a GSC connection and a mismatched/legacy property from looking green.

## Store isolation

- `app/routes/app.seo.tsx` authenticates the current merchant with `authenticate.admin(request)`, then reads only `searchConsoleConnection.findUnique({where:{shop}})`.
- Active GSC status triggers one **read-only** Shopify Admin query for `shop.myshopifyDomain` and `shop.primaryDomain.host` through the existing `primaryDomainForShop` helper; it verifies that Shopify returned the expected shop.
- A failed domain request is displayed as **unverified**; it does not break the catalog audit or silently assume a match.
- The exact HTTPS URL-prefix property must match the primary host using `matchesPrimaryDomain`. Legacy `sc-domain:` values, cross-store domains, other protocols, subdomains and paths are rejected.
- No public Monika Blunder Beauty audit artifacts, claims, product details or experimental outcomes are imported into Artemis's merchant tables.

## Verification

Run:

```bash
node --import tsx --test tests/seo-measurement-readiness.test.ts
npm test
npm run typecheck
npm run build
```

The route does not define a mutation action. This component adds no new permission scopes and does not change the existing optional Google OAuth consent flow. The test suite covers absent/mismatched/inactive GSC connections, null product URLs, partial/failed catalogs, and the inability to infer measurable SEO impact from exact GSC site scope alone.

## Current development-store evidence (2026-11-02)

The Artemis development SQLite database has no `SearchConsoleConnection` row and no `OrganicDailyMetric` rows for `artemisti.myshopify.com`. The separately verified Shopify product sample returned 13 active Online Store-published products, all with null storefront URLs while the development storefront served a password form. The page must therefore show **no usable public product pages, no linked GSC property, and no measured SEO outcome**.

The following step requires an actual merchant to opt into a verified **read-only** Google Search Console property and, later, authorize any real intervention. Page-level metrics, independent consent verification and a proper experiment timeline still need development. This page must not imply those features already work.
