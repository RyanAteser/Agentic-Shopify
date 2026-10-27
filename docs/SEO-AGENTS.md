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
Headers: `Content-Type: application/json`; `X-Agent-Key: <secret>` (stored in an n8n Header Auth credential, never in the workflow JSON)
App-side secret: `N8N_RANKING_SECRET` from the backend secret manager, different from the blog webhook key.

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

The ingestion endpoint:
- Requires HTTPS in production, shared secret, and an existing installed Shopify tenant.
- Rejects malformed ranks, unsafe URLs, future dates, oversized batches. A found rank requires a result URL; a not-found rank requires a null position and an empty URL.
- Resolves the shop's **current primary storefront host** from the authenticated Shopify Admin API (shop.myshopifyDomain + shop.primaryDomain.host) on each import; only exact-host HTTPS results are accepted. The supplied shop/domain in n8n is not itself evidence of ownership. Requests fail closed (503) if the Shopify offline session/domain query is unavailable. This is conservative: secondary Shopify Markets domains and redirects need a separate authenticated domain allowlist before their results can be imported.
- Uses a single DB transaction and store-row lock for the complete batch, so a database error cannot leave half a batch imported and uninstall/redaction cannot leave post-deletion orphaned ranking rows.
- Upserts on (shop, keyword, engine, country, device, observedAt), preventing duplicate rows on retries.
- Never changes product metadata or publishes articles.
- Is intentionally a **trusted server-to-server ingest route**. The current global X-Agent-Key is **not** tenant-specific: possession of it can still submit fabricated observations for any installed tenant. Primary-domain attestation prevents cross-domain ranking contamination but does not prove the SERP measurement or caller's tenant authorization. Per-tenant connector identities, key rotation, payload provenance, and rate limits remain mandatory before public multi-merchant launch.
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
