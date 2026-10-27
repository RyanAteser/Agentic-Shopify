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
- Upserts on (shop, keyword, engine, country, device, observedAt), preventing duplicate rows on retries.
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

## Recommended next work
- Full Shopify pagination, collection and article indexing, internal-link checks and canonical information.
- Google Search Console OAuth and verified domain-property mapping with data minimization.
- Work queue linking search opportunities to actionable merchant-reviewed content drafts.
- Source references, 28-day baselines and revision attribution. Establish seasonality and controls where possible.
- Failure recovery, cost-per-SERP-task ceilings and a per-merchant daily cap on external requests.

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
