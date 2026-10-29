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

**Explicit rank-evidence contract (2026-10-28):** The connector must send `position` and `targetUrl` on **every** record. A found organic result requires an integer `position` from 1 to 200 and its observed HTTPS `targetUrl`. A confirmed not-found result requires `"position": null` and `"targetUrl": ""`. Missing fields, `undefined`, a null URL, or a found rank without its URL now fail validation with HTTP 400 **before** the per-merchant quota reservation or Shopify domain lookup. A missing rank in an n8n expression or incomplete Bright Data response is **unknown**, not evidence that the page disappeared from search. Quarantine that record; do not coerce `undefined` to `null`, invent a rank from list order, or retry a malformed batch unchanged. A confirmed not-found means only **not observed in the explicitly sampled SERP depth and context**, not deindexed from Google. Verify the actual Bright Data export mapping and rank semantics: `organic[].rank` and `organic[].global_rank` may represent different ranking concepts. [Bright Data SERP reference](https://github.com/brightdata/skills/blob/main/skills/bright-data-best-practices/references/serp-api.md), [n8n data-transformation guidance](https://docs.n8n.io/build/work-with-data/transform-data/expressions-for-data-transformation/).

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

## Read-only Bright Data preview: request-context integrity (2026-10-28)

The standalone `normalizeBrightDataOrganicGoogle` adapter and `scripts/brightdata-organic-preview.ts` now require `requestUrl` in the local context JSON, **copied from the actual Google search URL submitted to Bright Data**, not reconstructed from a merchant profile. For example, a hypothetical English-language US desktop request could use `https://www.google.com/search?q=leather+boots&gl=us&hl=en&brd_json=1&start=0&pws=0`. This is a **format illustration**, not a live search or measured ranking.

The adapter verifies that the request's query, `gl` country and `brd_mobile` device match the claimed context. Because the current ranking schema does not store language, search vertical or SERP page, it deliberately supports only `hl=en`, the first standard Google web-results page (`start=0` or omitted), `brd_json=1`, and the standard desktop or `brd_mobile=1` mobile mode. It rejects unknown URL parameters, unsupported locales, personalized `pws=1`, extra search dimensions and duplicate parameters rather than merging incomparable observations. This is **not** a restriction on the existing ingestion endpoint, which is unchanged and still requires separate provenance verification.

Bright Data's [parsed-response example](https://github.com/brightdata/skills/blob/main/skills/bright-data-best-practices/references/serp-api.md) does **not** promise `general.gl` in the response, so a missing country echo is not by itself a validation failure when the original request URL supplies `gl`. The request URL is caller-supplied evidence and can itself be forged; this check does **not** authenticate Bright Data, prove a scrape occurred, or establish result completeness. An authenticated request/response export with job identity, locale and capture time remains a production gate. Non-English or later-page monitoring requires extending the persisted comparison dimensions before import.

## New merchant-facing pages
- `/app/team`: 10 specialist agents, statuses and safe action boundaries.
- `/app/seo`: initial active Online Store product metadata audit (up to 100 products across two pages) + imported rank snapshots.
- `/app`: blog agent review/publish queue.
- Product SEO audit is informational. It is not a 100-point scoring system or a guarantee of better rankings.
- Shopify `read_products` access required for catalog audit. Only run on merchants who granted the scope.
- Link observations to the merchant's store via trusted app session for UI and scoped database.
- Validate real n8n parsed output against this contract; screenshot alone cannot prove node field shapes or credential configuration.

## Published Online Store scope (2026-10-28)

The product metadata audit and Store Manager now query `status:active published_status:published` and additionally require Shopify's non-null, HTTPS `onlineStoreUrl` before evaluating a product. Shopify documents `published_status:published` as Online Store publication and `onlineStoreUrl: null` as not published to that channel. Active products sold only through POS or other channels are not storefront SEO opportunities; recommending Google title/meta edits for them wastes merchant time. A null URL is excluded rather than treated as an SEO error.

This is a **bounded 100-product maximum sample** (two 50-product cursor pages), not a full catalog audit. The dashboard and Store Manager use the same validated query and explicitly warn when Shopify reports additional pages. If either page fails or lacks pagination metadata, the entire catalog read is marked unavailable rather than presenting a partial sample as complete. A published Online Store URL does not prove Google indexing, crawl access, canonical selection, or availability in every Shopify Market. If a product disappears from a subsequent sample, its old recommendation is preserved rather than automatically marked fixed; a separate verified publication-status check would be needed to retire it. Do not claim traffic or revenue improvement without merchant data.

Shopify's [cursor pagination guidance](https://shopify.dev/docs/api/usage/pagination-graphql) defines `pageInfo.hasNextPage` and `endCursor`. We deliberately stop after two pages to bound API cost and latency; remaining products are not silently considered audited. Cross-page duplicate IDs and invalid cursor progress fail closed. This improves sampled coverage, not verified SEO outcomes.\n\nOfficial references: [Shopify products query published_status](https://shopify.dev/docs/api/admin-graphql/latest/queries/products), [Shopify Product.onlineStoreUrl](https://shopify.dev/docs/api/admin-graphql/latest/objects/Product).

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


## Password-protected storefront URL coverage (2026-10-28)

Shopify's `onlineStoreUrl` documentation says a null URL means the product is not
published to the Online Store. However, [Shopify staff clarified in March 2026](https://community.shopify.dev/t/onlinestoreurl-returns-null-even-when-filtering-with-published-status-online-store-channel/32775/2)
that **password-protected stores, including development stores, can return null
URLs for published, active products**. Therefore a null URL is not reliable
proof of unpublished inventory. We must not construct an assumed public URL
or claim to have audited rendered metadata on a password-protected storefront.

The SEO dashboard now reports the total sampled published products separately
from the number with usable HTTPS storefront URLs. When Shopify returns null
or invalid URLs, the dashboard and Store Manager show an explicit coverage
warning; excluded pages are not evaluated, and missing samples do not retire
existing recommendations. A fully empty valid GraphQL sample remains distinct
from a nonempty sample with no evaluable URLs. This does **not** bypass password
protection or create an SEO finding for inaccessible pages.

Validation: deterministic pure coverage tests added. Confirm behavior against
an authorized password-protected Shopify development store and a storefront
without password protection. No change to app permissions or live store data.

## Product metadata accuracy and stale-alert lifecycle (2026-10-27)

Shopify [documents](https://shopify.dev/docs/apps/build/marketing/optimize-storefront-seo) that a new product's search-engine title and description default to its product title and description. Therefore an empty `seo.description` alone is **not** evidence that a rendered product page lacks a meta description. The audit now flags a high-priority missing-description case only when both the custom SEO description and the product description are blank. This is a metadata heuristic, not a storefront HTML crawl: themes and apps can override rendered tags.

The former 165-character warning was not a Google rule. [Google](https://developers.google.com/search/docs/appearance/snippet) states that snippets are generated primarily from page content, may use meta descriptions, and have **no fixed character limit**. Shopify's [product editor guidance](https://help.shopify.com/en/manual/products/add-update-products) warns that descriptions over 320 characters may be cut off in previews, so the advisory now uses that platform-specific threshold and never claims a ranking penalty.

Store Manager marks pending `seo_review` alerts as `superseded` only when the same product was included in a successful nonempty catalog sample and the original finding is absent. Missing products in a bounded 100-item sample are not evidence of resolution. If the same finding reappears, only a machine-superseded task reopens; manually approved, dismissed, applied, and resolved decisions remain unchanged. The Outdated filter exposes these machine-retired alerts. This improves task accuracy, not measured SEO lift or a verified storefront crawl. Verify with an authorized development store before production.

## Product title evidence and partial-catalog safety (2026-10-27)

Shopify [defaults a product search title to the product title](https://shopify.dev/docs/apps/build/marketing/optimize-storefront-seo) when no custom SEO title is supplied. The audit now treats whitespace-only custom titles as blank and uses that fallback. [Google Search Central](https://developers.google.com/search/docs/appearance/title-link) states there is **no fixed title-element character limit**; the old 70-character warning was not a ranking rule and is removed. Review actual rendered titles rather than interpreting length as a penalty.

Duplicate effective titles are now reported for **every sampled product** in a matching group, regardless of API order, with whitespace and case normalized. This is only a bounded 100-product sample and not a full-catalog, rendered-HTML or indexability audit. Themes may add branding or change titles, and duplicates may be intentional. No product is edited.

To avoid claiming a duplicate was fixed merely because its counterpart fell outside the next sample, the Store Manager retains a pending duplicate-title recommendation if the product's observed effective title is unchanged. It retires the specific prior observation only after seeing that product's title change; missing historical title evidence fails closed. Fresh findings update pending evidence, while merchant approvals and dismissals remain untouched. This is conservative and can retain an old warning until the product changes or a merchant reviews it. Full pagination, rendered-title verification and better group-level resolution are future work.

**Validation:** automated pure audit tests and database-backed recommendation lifecycle tests; not verified against a real Shopify development store. Measure alert precision and merchant time spent per accepted recommendation before claiming benefit.

## Recovered ranking-drop alert lifecycle (2026-10-28)

Store Manager previously kept a pending `ranking_drop` alert indefinitely after a
SERP observation showed a three-place or greater decline. Even when a newer
same-market snapshot of the **same landing page** returned to within two
positions of the pre-drop rank, the old task stayed actionable.

The manager now moves a pending alert to **Outdated** (`superseded`) only when
the newest available observation for the exact keyword, engine, country and
device is (1) later than the alert, (2) no older than 14 days, (3) the same
HTTPS landing page ignoring fragments, and (4) at most two places worse than
the original pre-drop position. Missing observations, a different landing
page, a not-found result, invalid/legacy evidence, or a stale observation
**do not prove recovery**. Approved, dismissed and resolved merchant decisions
are never rewritten. A subsequent distinct drop creates a new task with a
new timestamp; historical evidence is preserved.

The scan reads the latest 300 merchant-specific rank rows and reconciles at
most 200 pending ranking alerts per sync. If a market is absent from that
sample, its alert is retained. This is an operational noise-reduction rule,
**not** evidence of durable ranking recovery, traffic growth, revenue lift,
or content causality. Google cautions that search positions fluctuate and
recommends investigating Search Console traffic before major content changes:
https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops

Validation: deterministic pure comparison and SQLite-backed manager regression
tests added; hosted CI and real Bright Data payload validation remain release
gates. Measure false-alert rate, merchant dismissals, and minutes per useful
SEO action in an authorized pilot.


## Repeated SERP decline confirmation (2026-10-28)

**Development-only triage change:** Store Manager previously created a high-priority
`ranking_drop` recommendation after just **two** comparable Bright Data SERP
snapshots separated by at least three rank positions. A one-off SERP fluctuation
could become a merchant task, despite no supporting Search Console traffic data.

The new rule requires **three consecutive distinct timestamps** for the same
keyword, search engine, country, device and exact HTTPS landing page (URL
fragments ignored; paths and queries preserved). Both the middle and newest
organic rank must be at least **three places worse than the oldest baseline**.
The latest snapshot must be no older than 14 days, and neither adjacent gap
may exceed 28 days. We never skip a newer recovery, different URL or missing
rank to cherry-pick older evidence. The alert stores all three timestamps and
positions, and its rationale explicitly asks the merchant to check Search
Console before changing content.

This is a **heuristic**, not a statistically significant trend. Three
correlated scrapes, regional SERP volatility, device differences, personalization,
Google updates or a biased keyword set can still mislead. The confirmation
rule trades slower detection and fewer opportunities for potentially fewer
transient false alarms. Existing pending historical alerts are not erased or
retroactively reclassified. Store Manager visibly labels legacy alerts without
three-observation evidence as **unconfirmed**; they still use the existing,
conservative same-market recovery mechanism. This is a display warning, not
proof that the historical signal was false.

Google explicitly cautions that small ranking fluctuations can occur without
requiring changes and recommends reviewing Search Console traffic before
major interventions:
https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops

**Evidence:** synthetic regression tests cover a one-snapshot spike, recovery,
three sustained observations, intervening URL changes, stale samples and
post-recovery new alerts. These are behavioral tests, not measured alert
precision. In an authorized pilot, compare blinded merchant usefulness of
old two-point and new three-point candidates, false-alert rate, GSC clicks,
dismissals and review minutes. Pre-register a minimum useful-alert precision
before adopting any stronger claims. No live merchant ranking data or
Shopify store was accessed or changed.

## Shopify catalog response completeness (2026-10-28)

A successful HTTP/GraphQL request is not evidence that Shopify returned the
requested product connection. Previously, both SEO surfaces converted missing
`data.products.nodes` or an explicit `null` node list into an empty sample.
The SEO dashboard could then report "No obvious metadata issues" without
having inspected any product, and Store Manager silently treated the catalog
as available.

Both surfaces now use the same fail-closed product response parser. A
**verified empty** `nodes: []` is valid; missing connections, malformed
nodes, duplicate product IDs, incomplete selected fields and GraphQL errors
are treated as **unavailable**, not as a clean SEO result. The dashboard
displays a catalog warning; Store Manager preserves existing recommendations
rather than treating absent evidence as remediation. Legitimate null
`onlineStoreUrl` values remain supported and are excluded by the existing
Online Store eligibility check. No Shopify content is modified.

This is a defensive response-integrity improvement, not a guarantee of full
catalog coverage. The query still samples at most 50 published products.
Pure parser tests and mocked Manager tests were added; full repository CI,
PostgreSQL and an authorized development-store response replay remain
release gates. Measure false-clean audit incidence and merchant time spent
before attributing business benefit.


## Read-only Bright Data parsed-JSON preview (2026-10-28)

The optional local adapter in app/lib/brightdata-organic.ts and the CLI in
scripts/brightdata-organic-preview.ts help an operator validate a **real**
Bright Data Google SERP JSON export before mapping it in n8n. This is **not**
connected to a live connector, does not call Bright Data, and never POSTs to
Shopify. It does not activate the workflows.

Bright Data's parsed Google JSON separates organic[] from paid[] and exposes
organic[].rank (organic position), organic[].global_rank (SERP-wide placement),
and organic[].link (result URL). We intentionally use **organic[].rank**, never
global_rank or paid results. The adapter checks the response query, engine,
device, optional reported gl country, unique valid ranks, valid links and the
exact HTTPS storefront host. It returns at most the highest-ranked matching
organic URL, then applies the existing strict ranking parser.

Create a **local** context.json using the actual request and authenticated
Shopify primary domain (example values below are illustrative):

~~~json
{
  "keyword": "leather boots",
  "country": "US",
  "device": "desktop",
  "observedAt": "2026-10-28T11:55:00Z",
  "primaryHost": "example.com"
}
~~~

Run locally: npx tsx scripts/brightdata-organic-preview.ts raw-serp.json context.json

The result is a JSON object with an observations array, **not** a signed or
authorized import. No-match and empty organic lists produce an **empty array**,
not a fabricated not-found rank. Never infer a null position from an
incomplete SERP depth or a failed scrape. A real not-found observation requires
separate proof of requested depth and successful completed pagination.

The preview cannot independently verify that context.json represents the
actual scrape request, that the primaryHost is Shopify-attested, that the
SERP export is authentic, or that all requested pages completed. It supports
Google parsed JSON only; other Bright Data formats, Bing and tablet require
their own validated mapping. Do not copy raw merchant data or credentials into
commits, logs or issues. Validate with an authorized export and keep the
existing connector key, tenant isolation, rate limits and human approval gates.

Source: Bright Data's [SERP API parsed JSON reference](https://github.com/brightdata/skills/blob/main/skills/bright-data-best-practices/references/serp-api.md).
