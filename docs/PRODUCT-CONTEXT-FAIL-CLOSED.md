# Verified Shopify product context before AI generation

**Status: development-only, not deployed.** This check does not publish content, change a store, or authorize paid model calls. It runs in the application before the durable queued-to-running claim and before the n8n webhook.

## Problem and bounded fix

The previous product discovery code returned an empty product list for every Shopify API failure, malformed response or GraphQL error. The writer prompt then received `verifiedStoreProducts: []`, indistinguishable from a genuine shop with no published products. This could consume a merchant generation credit and paid AI requests on a generic article while concealing an upstream outage.

The application now:
- Requests `shop.myshopifyDomain` alongside up to 20 active, published products and their `onlineStoreUrl`.
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

The sample is only the first 20 published products and does not attest completeness or validate the model's output against those products. Shopify may legitimately return no eligible products. A temporary Shopify outage now prevents generation rather than silently producing a generic article. Manual requests may need to be retried after recovery; scheduled jobs use their existing refund/rewind policy. The n8n writer still needs live integration verification, licensing clearance and consented merchant validation.

## Staging experiment and outcome hypothesis

In an authorized development store, inject a 429/GraphQL `THROTTLED` error, a malformed response and a network failure. Verify zero n8n POSTs and zero retained free-credit charges for those preflight failures. Next verify that a real empty published-product set still permits a non-product article, while a valid published product supplies its exact storefront URL. Test cross-shop domain mismatch with synthetic fixtures, not real customer data.

Measure: failed-context drafts prevented, preflight refund accuracy, percent of drafts referencing unverified products, merchant acceptance rate and median editing minutes. Compare against a fixed baseline with explicit denominators. Do not attribute traffic, ranking, conversion or revenue gains without verified merchant data and appropriate controls.

## Complete URL preservation and bounded writer context (2026-10-29)

A second failure mode was found in the inactive n8n writer. The original `Prepare Brief` code called `JSON.stringify(...).slice(0, 10000)`. For a merchant with many long descriptions and URLs, this could cut the serialized JSON in the middle of a product or URL, so the model received incomplete and potentially misleading product evidence. Separately, the Shopify context parser truncated `onlineStoreUrl` at 350 characters after validation, silently changing the product link.

The writer now builds a bounded, **valid JSON object** with complete product entries. It limits editorial field sizes, considers at most 20 sampled products, includes a product only when its **whole URL** and entry fit, and sets `productSampleTruncated` plus `productCountAvailable` when entries are omitted. It does not imply that the sample represents the full Shopify catalog. The Shopify parser now rejects URLs longer than 350 characters **before** claiming a job rather than inventing a shortened URL. No Shopify write or paid AI request is involved in this code-level test.

Synthetic tests exercise 20 long products, large merchant briefs, whole-URL preservation, explicit omission, valid JSON, a legitimate 350-character URL and rejection at 351 characters. The 10,000-character budget is an internal prompt-control heuristic, not a model-token guarantee or a Google SEO rule. The 350-character URL bound is likewise an application limit; some legitimate long URLs may now cause a safe preflight failure and merchant retry/support work. Do not claim product accuracy or link correctness from prompt formatting alone. The model may still invent claims, and a human must verify every product reference before approving publication.

**Staging acceptance:** With an authorized development store and isolated n8n, test product catalogs whose total serialized size exceeds the prompt budget; verify that all supplied URLs match Shopify's originals, no partial URLs appear, and omissions are disclosed. Measure the fraction of context-failed jobs, review corrections, broken product links and draft acceptance before considering a wider rollout. Google's [ecommerce URL guidance](https://developers.google.com/search/docs/specialty/ecommerce/designing-a-url-structure-for-ecommerce-sites) recommends consistent internal product URLs, but no ranking or conversion improvement is established here.
