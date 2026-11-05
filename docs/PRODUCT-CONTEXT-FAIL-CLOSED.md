# Verified Shopify product context before AI generation

**Status: development-only, not deployed.** This check does not publish content, change a store, or authorize paid model calls. It runs in the application before the durable queued-to-running claim and before the n8n webhook.

## Problem and bounded fix

The previous product discovery code returned an empty product list for every Shopify API failure, malformed response or GraphQL error. The writer prompt then received `verifiedStoreProducts: []`, indistinguishable from a genuine shop with no published products. This could consume a merchant generation credit and paid AI requests on a generic article while concealing an upstream outage.

The application now:
- Requests `shop.myshopifyDomain` alongside up to 20 active, published products, their `onlineStoreUrl`, and `pageInfo.hasNextPage`. Pagination evidence is mandatory even when no products are returned.
- Rejects GraphQL errors, failed HTTP responses, transport/JSON failures, wrong-tenant results, missing product lists, malformed product fields and unsafe product URLs. The error is generic to avoid leaking Shopify payloads.
- Accepts an **attested empty catalog** as a legitimate case for educational content. A null `onlineStoreUrl` means that particular product has no published online-store URL, not that Shopify failed.
- Performs this read before claiming or POSTing a job. Existing manual and scheduled failure paths can conditionally fail/refund a definite pre-network failure; recovery does not blindly replay a running or uncertain job.
- Keeps the human editorial approval and separate Shopify publication gate unchanged.

This is not a new API permission or a guarantee of factual correctness. It verifies that the sampled product fields came from the authenticated Shopify API for the requested shop, not that every product fact, URL or model claim is accurate.

## Why this matters

Shopify documents `Product.onlineStoreUrl` as nullable when a product is not published to the online store, and `Shop.myshopifyDomain` as the shop domain associated with the access token. GraphQL Admin queries have per-app/per-store cost limits and can fail or be throttled; a failed read must not be treated as an observed zero.

- [Shopify Product fields](https://shopify.dev/docs/api/admin-graphql/latest/objects/Product)
- [Shopify Shop fields](https://shopify.dev/docs/api/admin-graphql/latest/objects/Shop)
- [Shopify GraphQL Admin API rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)

## Verification and limitations

Unit tests cover successful and genuinely empty catalogs, wrong tenant, GraphQL throttle/error, HTTP failure, JSON failure, malformed responses and invalid product URLs. CI must verify both SQLite and PostgreSQL builds; this is **not** a real Shopify development-store integration test.

The sample is only the first 20 published products and does not attest completeness or validate the model's output against those products. Shopify's `hasNextPage` distinguishes a complete bounded result from a first page with additional products. Shopify may legitimately return no eligible products. A temporary Shopify outage now prevents generation rather than silently producing a generic article. Manual requests may need to be retried after recovery; scheduled jobs use their existing refund/rewind policy. The n8n writer still needs live integration verification, licensing clearance and consented merchant validation.

## Staging experiment and outcome hypothesis

In an authorized development store, inject a 429/GraphQL `THROTTLED` error, a malformed response and a network failure. Verify zero n8n POSTs and zero retained free-credit charges for those preflight failures. Next verify that a real empty published-product set still permits a non-product article, while a valid published product supplies its exact storefront URL. Test cross-shop domain mismatch with synthetic fixtures, not real customer data.

Measure: failed-context drafts prevented, preflight refund accuracy, percent of drafts referencing unverified products, merchant acceptance rate and median editing minutes. Compare against a fixed baseline with explicit denominators. Do not attribute traffic, ranking, conversion or revenue gains without verified merchant data and appropriate controls.

## Complete URL preservation and bounded writer context (2026-10-29)

A second failure mode was found in the inactive n8n writer. The original `Prepare Brief` code called `JSON.stringify(...).slice(0, 10000)`. For a merchant with many long descriptions and URLs, this could cut the serialized JSON in the middle of a product or URL, so the model received incomplete and potentially misleading product evidence. Separately, the Shopify context parser truncated `onlineStoreUrl` at 350 characters after validation, silently changing the product link.

The writer now builds a bounded, **valid JSON object** with complete product entries. It limits editorial field sizes, considers at most 20 sampled products, includes a product only when its **whole URL** and entry fit, and sets `productSampleTruncated` plus `productCountSampled` when entries are omitted. It does not imply that the sample represents the full Shopify catalog. The Shopify parser now rejects URLs longer than 350 characters **before** claiming a job rather than inventing a shortened URL. No Shopify write or paid AI request is involved in this code-level test.

Synthetic tests exercise 20 long products, large merchant briefs, whole-URL preservation, explicit omission, valid JSON, a legitimate 350-character URL and rejection at 351 characters. The 10,000-character budget is an internal prompt-control heuristic, not a model-token guarantee or a Google SEO rule. The 350-character URL bound is likewise an application limit; some legitimate long URLs may now cause a safe preflight failure and merchant retry/support work. Do not claim product accuracy or link correctness from prompt formatting alone. The model may still invent claims, and a human must verify every product reference before approving publication.

**Staging acceptance:** With an authorized development store and isolated n8n, test product catalogs whose total serialized size exceeds the prompt budget; verify that all supplied URLs match Shopify's originals, no partial URLs appear, and omissions are disclosed. Measure the fraction of context-failed jobs, review corrections, broken product links and draft acceptance before considering a wider rollout. Google's [ecommerce URL guidance](https://developers.google.com/search/docs/specialty/ecommerce/designing-a-url-structure-for-ecommerce-sites) recommends consistent internal product URLs, but no ranking or conversion improvement is established here.

## Catalog pagination evidence in writer prompts (2026-10-29)

**Finding:** The earlier whole-URL packing fix correctly marked products omitted *inside n8n*, but the Shopify query returned only 20 products without pagination metadata. A store with 21 or 20,000 products could therefore yield 20 fitting records and `productSampleTruncated: false`. The AI brief had no evidence that the other products existed, increasing the risk of misleading product availability/completeness statements. This is a reproducible contract gap, not an observed merchant incident.

**Fix:** Shopify's read-only query now requires `pageInfo.hasNextPage` from the same authenticated, tenant-attested response. Missing or malformed pagination fails before dispatch and before paid generation. The application passes the boolean as `productCatalogHasMore` to n8n, whose writer now requires both the catalog array and the explicit boolean. `productSampleTruncated` is true if Shopify reports more pages **or** if any sampled product entry is omitted by prompt packing. `productCountSampled` counts URL-bearing products in the bounded sample only; it is **not** the store's total catalog size. A verified empty response with `hasNextPage: false` remains valid. The AI must not claim that the sample is the complete catalog or that unlisted products do not exist.

**Tests:** Synthetic 20-product catalogs with and without further pages, malformed/missing pageInfo, a verified empty catalog, oversized entries and missing n8n evidence. These test the data contract, not model factuality or a live Shopify response. No extra Shopify API calls, scopes, store writes, model calls or deployment were made.

**Pilot hypothesis:** Fewer unsupported product-availability claims and less merchant correction time. On an authorized development store, test catalogs of 0, 20 and 21+ published products and compare the exact n8n prompt flags to Shopify pagination. In a consented merchant pilot, record false completeness claims per reviewed draft and median correction minutes with denominators. This does not prove more organic traffic, conversions or revenue.

Primary source: [Shopify GraphQL `products` pagination and `pageInfo`](https://shopify.dev/docs/api/admin-graphql/latest/queries/products). The app remains development-only and the n8n commercial license and real-store validation gates remain open.


## Missing storefront URL provenance (2026-10-29)

**Additional accuracy gap:** Shopify's nullable `Product.onlineStoreUrl` was previously filtered out before the writer received the sample. If Shopify returned two published products with null URLs, the model received `productCountSampled: 0`, `productSampleTruncated: false` and an empty product array, indistinguishable from an actually empty result. This could encourage unsupported assertions that the merchant has no products. A null URL can occur for a published product, including on password-protected development storefronts; it does not establish inventory or sales availability.

The app now preserves the count of **all Shopify rows returned** (`productCatalogSampledCount`) and the number without storefront URLs (`productCatalogMissingUrls`) alongside the eligible URL-bearing sample. The inactive n8n writer validates the count invariant `sampled = URL-bearing + missing-URL` before accepting a brief, and explicitly tells the model that missing URLs do not mean missing products. Its incomplete-context flag is set when URL-less rows are omitted, Shopify reports further pages, or product entries exceed the bounded prompt. Every Shopify row, including a null-URL row, must still have valid title and description fields. This adds no API calls, permissions, or external writes.

Synthetic tests distinguish a genuine zero-row result from two null-URL rows, reject inconsistent counts and malformed null-URL products, and preserve the existing 20-product/10,000-character budget. **Limit:** counts only describe the first page; they do not prove the rest of the catalog, inventory status, live links, model factual accuracy or merchant outcomes. In authorized staging, test a password-protected development store with null `onlineStoreUrl` and verify the n8n brief and generated draft never claim the catalog is empty. Measure false product-absence claims per reviewed draft and editing time. No live merchant results have been measured.

Source: [Shopify GraphQL Product.onlineStoreUrl](https://shopify.dev/docs/api/admin-graphql/latest/objects/Product).
