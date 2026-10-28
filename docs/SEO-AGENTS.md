# Shopify SEO + Bright Data n8n Adapter
**Status:** Read-only metadata dashboard and ranking ingestion implemented on branch. No Shopify or n8n credentials connected, and no live rankings ingested.

## Reuse the existing ranking workflow
Based on the merchant-supplied n8n screenshot, the existing template has:
1. Daily schedule trigger
2. Keyword and domain input
3. AI SERP agent using Bright Data MCP and model/search agent
4. Structured SERP parser
5. Google Sheets result logger

**Do not replace it.** Add a second HTTP Request after "Parse SERP Results" or after the Sheets logger (depending on the error policy). Set the node to POST parsed **organic rankings** to the Shopify app; leave the Sheets path intact.

Endpoint: `POST https://<your-app-host>/api/seo/rankings`
Headers: `Content-Type: application/json`; `X-Agent-Key: <per-merchant connector key>` (stored in a shop-specific n8n Header Auth credential, never in workflow JSON).
There is no global ranking secret fallback. An operator must explicitly provision each shop.

### Request contract (demonstration only, NOT actual ranking measurements)
```json
{
  "shop": "demo.myshopify.com",
  "observations": [
    {
      "keyword": "leather ankle boots",
      "position": 7,
      "engine": "google",
      "country": "US",
      "device": "desktop",
      "targetUrl": "https://example.com/products/leather-ankle-boots",
      "observedAt": "2026-10-24T12:00:00.000Z"
    }
  ]
}
```
**Do not forward this illustrative request as real data.** Instead map the actual template's parsed organic result fields. Use `null` for not found in the sampled SERP, never `0`. Record the observation's real timestamp; preserve the country, locale and device the scraping job truly used. Up to 50 records per call, max 75 KB.

**Required evidence context (2026-10-27):** Every observation must explicitly provide `engine` (`google` or `bing`), `country` (uppercase two-letter ISO country code), `device` (`desktop` or `mobile`), and `observedAt` (RFC3339 date-time **with `Z` or numeric timezone offset**, e.g. `2026-10-24T12:00:00Z` or `2026-10-24T08:00:00-04:00`). These values must come from the actual SERP request/response, not inferred from the merchant's home country, server clock, or defaults. Unknown context must **fail the import**, not be labeled US/desktop/Google. An impossible calendar date, offset, or duplicate `(keyword, engine, country, device, observedAt)` in one batch is rejected with HTTP 400 before the Shopify API call. A duplicate *replay in a later request* remains idempotent through the database upsert.

This adapter currently has no `tablet` device category or locale/language dimension. Do not silently relabel tablet as desktop/mobile or merge different locales into the same ranking series; do not ingest such measurements until the schema and comparison keys are extended. Search Console's API uses different dimensions and ISO-3 country codes, and its **average position is not a point-in-time scraped SERP rank**. Source attestation still requires live Bright Data payload validation and connector provenance controls.

References: [Google Search Analytics API dimensions](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [Google guidance on comparing country/device slices](https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console).

The ingestion endpoint:
- Requires HTTPS in production, a hashed **shop-bound** connector credential, and an existing installed Shopify tenant.
- Rejects malformed ranks, missing search-engine/country/device context, ambiguous or timezone-free timestamps, duplicate snapshots in a batch, unsafe URLs, future dates, oversized batches. A found rank requires a result URL; a not-found rank requires a null position and an empty URL.
- Resolves the shop's **current primary storefront host** from the authenticated Shopify Admin API (shop.myshopifyDomain + shop.primaryDomain.host) on each import; only exact-host HTTPS results are accepted. The supplied shop/domain in n8n is not itself evidence of ownership. Requests fail closed (503) if the Shopify offline session/domain query is unavailable. This is conservative: secondary Shopify Markets domains and redirects need a separate authenticated domain allowlist before their results can be imported.
- Uses a single DB transaction and store-row lock for the complete batch, so a database error cannot leave half a batch imported and uninstall/redaction cannot leave post-deletion orphaned ranking rows.
- Treats (shop, keyword, engine, country, device, observedAt) as an **immutable measurement key**. Exact retries succeed without rewriting stored evidence; a later request that supplies a different position, result URL or source for the same key returns HTTP 409 and rolls back the entire batch. Do **not** automatically retry 409 conflicts; quarantine the payload, compare the source export and request context, and require an explicit operator correction process if the original observation was wrong. This does not prove the original measurement was authentic.
- Uses a durable, tenant-isolated **fixed UTC-hour admission budget** of 60 requests and 1,000 submitted observations per merchant. The budget is reserved before the Shopify Admin domain check and remains charged even if downstream validation fails or the same batch is retried. Exceeding either limit returns HTTP 429 with `Retry-After` (seconds until the next UTC hour). n8n must respect the header, back off, and avoid retry storms. This protects connector ingestion; it is not Shopify's own GraphQL cost bucket, a paid Bright Data spend cap, a sliding-window limit, or IP/edge abuse protection.
- Never changes product metadata or publishes articles.
- Uses a **shop-bound** 256-bit connector key (only its SHA-256 digest is stored). The route checks the exact shop and rechecks the digest inside the write transaction under the same row lock used for rotation, revocation and uninstall. Old shared keys fail closed. This does **not** prove Bright Data produced the measurement: gateway/IP abuse protection, external scrape cost caps, source provenance and actual connector mapping remain launch gates.
- Bright Data ranks are point-in-time sampled organic placements; Google Search Console aggregated average position/clicks/impressions remain **separate source types**.
- The manager only flags a page-level ranking drop when the two most recent distinct observations for the same keyword, engine, country and device also have the same nonempty HTTPS target URL (ignoring URL fragments). A changed or missing result URL is **not** proof of a page-level loss; the dashboard abstains from displaying a cross-page delta. The importer now attests the primary domain using Shopify, but other verified Markets domains and tenant-specific connector authorization remain production gates.

## New merchant-facing pages
- `/app/team`: 10 specialist agents, statuses and safe action boundaries.
- `/app/seo`: initial active-product metadata audit (up to 50 products) + imported rank snapshots.
- `/app`: blog agent review/publish queue.
- Product SEO audit is informational. It is not a 100-point scoring system or a guarantee of better rankings.
- Shopify `read_products` access required for catalog audit. Only run on merchants who granted the scope.
- Link observations to the merchant's store via trusted app session for UI and scoped database.
- Validate real n8n parsed output against this contract; screenshot alone cannot prove node field shapes or credential configuration.

## Published Online Store scope (2026-10-28)

The product metadata audit and Store Manager now query `status:active published_status:published` and additionally require Shopify's non-null, HTTPS `onlineStoreUrl` before evaluating a product. Shopify documents `published_status:published` as Online Store publication and `onlineStoreUrl: null` as not published to that channel. Active products sold only through POS or other channels are not storefront SEO opportunities; recommending Google title/meta edits for them wastes merchant time. A null URL is excluded rather than treated as an SEO error.

This remains a **50-product sample**, not a full catalog audit. A published Online Store URL does not prove Google indexing, crawl access, canonical selection, or availability in every Shopify Market. If a product disappears from a subsequent sample, its old recommendation is preserved rather than automatically marked fixed; a separate verified publication-status check would be needed to retire it. Do not claim traffic or revenue improvement without merchant data.

Official references: [Shopify products query published_status](https://shopify.dev/docs/api/admin-graphql/latest/queries/products), [Shopify Product.onlineStoreUrl](https://shopify.dev/docs/api/admin-graphql/latest/objects/Product).

## Recommended next work
- Full Shopify pagination, collection and article indexing, internal-link checks and canonical information.
- Google Search Console OAuth and verified domain-property mapping with data minimization.
- Work queue linking search opportunities to actionable merchant-reviewed content drafts.
- Source references, 28-day baselines and revision attribution. Establish seasonality and controls where possible.
- Failure recovery, cost-per-SERP-task ceilings and a per-merchant daily cap on external requests.
- Explicit, audited operator-only correction workflow for genuinely incorrect historical snapshots; never silently overwrite data on n8n retries.

## Relevant documentation
- Shopify Product GraphQL SEO object: https://shopify.dev/docs/api/admin-graphql/latest/objects/Product
- Shopify product query: https://shopify.dev/docs/api/admin-graphql/latest/queries/products
- n8n Header Auth: https://docs.n8n.io/integrations/builtin/credentials/httprequest/

## Operator-only credential provisioning (development; not live)

After applying the PostgreSQL migration, a trusted operator may provision an explicitly authorized, installed development store from a secure shell (never in CI or an issue comment):

```sh
npx tsx scripts/ranking-connector-key.ts rotate example.myshopify.com --confirm=example.myshopify.com
```

Save the one-time key directly into that shop’s dedicated n8n Header Auth credential or secret manager. Only a SHA-256 digest is stored in the app database. Rotating immediately invalidates the old key. To revoke:

```sh
npx tsx scripts/ranking-connector-key.ts revoke example.myshopify.com --confirm=example.myshopify.com
```

No key is created automatically at install. Missing, old global, wrong-shop and revoked keys get HTTP 401. A key rotated after the initial request check is rejected again at transaction commit. Do not share a Header Auth credential between shops or give merchants configurable n8n workflow access until written commercial licensing clearance. No live Bright Data payload, signed provenance, gateway/IP abuse protection or external cost-control validation has been completed. The application-side fixed-hour import budget is implemented but must still be exercised with live connector traffic.


## Product metadata accuracy and stale-alert lifecycle (2026-10-27)

Shopify [documents](https://shopify.dev/docs/apps/build/marketing/optimize-storefront-seo) that a new product's search-engine title and description default to its product title and description. Therefore an empty `seo.description` alone is **not** evidence that a rendered product page lacks a meta description. The audit now flags a high-priority missing-description case only when both the custom SEO description and the product description are blank. This is a metadata heuristic, not a storefront HTML crawl: themes and apps can override rendered tags.

The former 165-character warning was not a Google rule. [Google](https://developers.google.com/search/docs/appearance/snippet) states that snippets are generated primarily from page content, may use meta descriptions, and have **no fixed character limit**. Shopify's [product editor guidance](https://help.shopify.com/en/manual/products/add-update-products) warns that descriptions over 320 characters may be cut off in previews, so the advisory now uses that platform-specific threshold and never claims a ranking penalty.

Store Manager marks pending `seo_review` alerts as `superseded` only when the same product was included in a successful nonempty catalog sample and the original finding is absent. Missing products in a 50-item sample are not evidence of resolution. If the same finding reappears, only a machine-superseded task reopens; manually approved, dismissed, applied, and resolved decisions remain unchanged. The Outdated filter exposes these machine-retired alerts. This improves task accuracy, not measured SEO lift or a verified storefront crawl. Verify with an authorized development store before production.

## Product title evidence and partial-catalog safety (2026-10-27)

Shopify [defaults a product search title to the product title](https://shopify.dev/docs/apps/build/marketing/optimize-storefront-seo) when no custom SEO title is supplied. The audit now treats whitespace-only custom titles as blank and uses that fallback. [Google Search Central](https://developers.google.com/search/docs/appearance/title-link) states there is **no fixed title-element character limit**; the old 70-character warning was not a ranking rule and is removed. Review actual rendered titles rather than interpreting length as a penalty.

Duplicate effective titles are now reported for **every sampled product** in a matching group, regardless of API order, with whitespace and case normalized. This is only a 50-product sample and not a full-catalog, rendered-HTML or indexability audit. Themes may add branding or change titles, and duplicates may be intentional. No product is edited.

To avoid claiming a duplicate was fixed merely because its counterpart fell outside the next sample, the Store Manager retains a pending duplicate-title recommendation if the product's observed effective title is unchanged. It retires the specific prior observation only after seeing that product's title change; missing historical title evidence fails closed. Fresh findings update pending evidence, while merchant approvals and dismissals remain untouched. This is conservative and can retain an old warning until the product changes or a merchant reviews it. Full pagination, rendered-title verification and better group-level resolution are future work.

**Validation:** automated pure audit tests and database-backed recommendation lifecycle tests; not verified against a real Shopify development store. Measure alert precision and merchant time spent per accepted recommendation before claiming benefit.
