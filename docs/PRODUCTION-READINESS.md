# Production release gates — Agentic Shopify

**Release posture (2026-10-26): NOT production ready.** Code validation is not the same as real merchant success. Keep PR #1 draft and do not accept paying stores until every launch gate below is satisfied.

## What has actually been implemented
- Shopify embedded app skeleton, OAuth-protected merchant routes and guarded blog publishing.
- Three AI generation trial credits enforced with transactional reservations.
- n8n writer/editor, scheduled blog drafts, Store Manager scan, and Google Search Console sync workflows: importable JSON, **inactive by default**.
- Product SEO sample audit, logged Bright Data rank observations, manager inbox and approvals.
- Search Console read-only OAuth flow with one-time state, Shopify domain check, AES-256-GCM encrypted refresh tokens, site-level daily analytics and 28-day comparable baseline.
- Shopify privacy webhooks erase app data, OAuth tokens, organic metrics and recommendation history.
- Local SQLite development schema; PostgreSQL production schema with generated migration chain; Docker runtime as unprivileged user; DB readiness endpoint; CI for SQLite and Postgres.

## Hard go/no-go gates

| Gate | Current status | Completion proof required |
|---|---|---|
| Partner registration / app client ID | BLOCKED | Verified Shopify Partner app linked to repository and installed on a chosen dev store |
| Public HTTPS deployment | BLOCKED | Stable URL, TLS, separate secrets, availability and rollback plan |
| Managed PostgreSQL | Migration committed; NOT provisioned | Migration job runs on actual database with backup/restore test |
| Google OAuth | Code implemented; NOT connected | OAuth consent screen configured, allowed callback domain, verified store property, Google policy review |
| n8n | JSON ready; NOT connected | Authenticated instance, secure credential scopes, workflow publishing, end-to-end callback verification |
| Bright Data ranking connector | Normalization endpoint and per-tenant hashed keys coded; NOT connected | Operator-provisioned isolated n8n credentials, real workflow JSON mapping, verified SERP samples, edge abuse controls, external scrape cost limits and source provenance |
| Real Shopify publishing | Mock-tested only | Development store draft -> manual review -> one published article; confirm exactly-once behavior |
| Pricing | Proposed only | Shopify App Pricing setup and billing / entitlement webhooks verified |
| n8n commercial rights | Not yet confirmed | Written n8n guidance for configurable merchant automations or appropriate Enterprise/OEM contract |
| Privacy compliance | Handlers implemented; not validated live | Shopify HMAC failures return 401; uninstall and all mandatory compliance topics pass live replay |
| Security review | Partial | Third-party dependency audit, pentest, abuse and IDOR tests, CSP, CSRF, rate-limit verification |
| Operations | Partial | Error monitoring, job dead-letter/reconciliation queue, secret rotation, on-call response, incident playbook |
| Customer benefit | Not yet measured | Cohort of consented stores with before/after GSC coverage, retention, editor acceptance and merchant satisfaction |

No merchant traffic, sales, ranking improvement or revenue attribution has yet been established.

## Deployment

Use a **separate managed PostgreSQL production instance**, not the local Windows SQLite database or a database used for another business.

Production database operations (release job run **once**, not on every app pod):
\`\`\`sh
npm ci
npx prisma migrate deploy --schema prisma/schema.postgresql.prisma
npx prisma generate --schema prisma/schema.postgresql.prisma
npm run typecheck
npm run build
npm start
\`\`\`

Set \`DATABASE_URL\` to a PostgreSQL TLS connection string in the host's secret manager.
Create an \`SSL\`-enforcing connection configuration appropriate for your provider.
Run \`GET /health\` from your platform load balancer; HTTP 200 indicates database reachable; HTTP 503 indicates unavailable.
Store Shopify and Google credentials, `N8N_OUTBOUND_KEY`, and `N8N_CALLBACK_SECRET` only in secure runtime secrets. Ranking connector keys are provisioned per-shop, stored as hashes in the database, and delivered to the operator’s secure secret manager; never commit them.

For Google OAuth, register an HTTPS Web Application redirect URI:
\`https://YOUR_APP_HOST/auth/google/callback\`.
Request only \`https://www.googleapis.com/auth/webmasters.readonly\`, offline consent.
The stored property is selected from \`sites.list\` only if it matches the Shopify primary domain. In production, verify connection/disconnection and token rotation and review Google's OAuth verification obligations.

For n8n:
- Import and configure \`n8n/shopify-blog-writer.json\`,
  \`n8n/shopify-blog-scheduler.json\`,
  \`n8n/shopify-store-manager.json\`,
  and \`n8n/shopify-growth-gsc-sync.json\`.
- Set credentials in n8n's **Credential UI**, not JSON.
- Only enable after app deployment, production URL replacement and smoke tests.
- Use tight budgets and execution limits per merchant. n8n should never receive Shopify tokens or Google OAuth refresh tokens.

## Merchant editorial outcomes (read-only development)

The Growth page now reports rolling 28-day **creation cohorts** for generation requests and article drafts, with current publish/reject/review/reconciliation states. It abstains from a published-among-resolved percentage until at least five editorial decisions. The two creation cohorts must not be divided into a misleading draft-delivery rate; publication is not verified content quality or sales. See [EDITORIAL-METRICS.md](./EDITORIAL-METRICS.md) for precise denominators, caveats and the consented merchant pilot protocol. No live outcomes have been observed.

## Growth evaluation design

The primary outcome is **qualified organic search traffic and useful merchant actions**, not raw article output. Track:
1. Prelaunch baseline: 56 days of actual GSC site-level search clicks and impressions (two 28-day periods).
2. After publishing: monthly clicks/impressions and search position from the same verified property, engine and country.
3. Merchant behavior: useful draft acceptance, manual edit effort, approvals, repeat use, unsubscribes.
4. Once analytics permissions and consent exist: revenue attributed to organic search, add-to-cart, checkout conversion and repeat purchases. Never infer commerce revenue from GSC rankings alone.
5. Counterfactual: compare edited and similar unedited pages and account for seasonality, page age, promotions and Google indexing lag. Treat such comparisons as observational unless a controlled experiment is possible.
6. Stop conditions: inaccurate articles, trust incidents, negative conversion signals, runaway generation costs or unintended Shopify mutations.

### Search Console date coverage and interpretation

Google Search Analytics reports calendar dates in **America/Los_Angeles**, not UTC; the import and comparison now share one DST-aware 56-day window excluding the three most recent Pacific dates. The API can omit dates with no search data, and even finalized data can arrive late. Do **not** turn missing API rows into zero clicks or compare a 21-day total to a 28-day total. The growth scorecard only displays a percentage change when both adjacent 28-day windows contain 28 unique daily observations; otherwise it shows coverage and abstains. This conservative rule means a genuinely zero-traffic day omitted by Google can prevent a scorecard from displaying a comparison. A future, separately audited coverage-provenance model is required before safely reporting complete zero-traffic periods.

Reference: https://developers.google.com/webmaster-tools/v1/searchanalytics/query

**No performance guarantee**: agents can improve execution and measurement; rankings and sales depend on external factors.

## Backend reliability / privacy

- All merchant API mutations require authenticated Shopify sessions and explicit approval.
- Callback, manager and scheduler traffic still require shared server-to-server secrets; rotate and scope them before scale. Ranking ingest now requires per-merchant hashed connector keys, revocable/rotatable with an operator-only CLI, and transactional reauthorization before import. This does not replace provenance, quotas, or a licensing decision.
- Uncertain n8n POST outcomes enter \`dispatch_uncertain\` and do not automatically refund credits or blindly retry.
- Upserts are idempotent and never overwrite reviewed articles on callback retry.
- Background tasks cap shops per run; OAuth states expire; Google token storage is encrypted at rest.
- Google OAuth callback finalization consumes the pending state in the **same transaction** that persists the connection. Merchant disconnect, Shopify uninstall and shop redaction delete pending states, preventing a callback delayed by Google API requests from recreating a revoked connection. This is covered by database regression tests, but webhook delivery and OAuth lifecycle still require real development-store verification.
- Manager approvals are decisions, not automatic product edits.
- Privacy webhooks erase raw token and measurement tables. Test mandatory callbacks in Shopify Partner dashboard before submission.

## Commerce pricing recommendation (hypothesis only)
Standalone blog starter: $19/month. All-in-one launch: $49/month (blog + SEO + manager), Growth: $149, Operator: $399. Do not enable billing until app entitlement and usage reconciliation is implemented and priced against actual costs.

## Official documentation
- Shopify mandatory privacy: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- Shopify app pricing: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- Google OAuth server-side: https://developers.google.com/identity/protocols/oauth2/web-server
- GSC site access: https://developers.google.com/webmaster-tools/v1/sites/list
- GSC Search Analytics query: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- n8n licensing: https://support.n8n.io/article/can-i-use-your-license-for-my-use-case

## Ranking connector admission budget (development)

The ranking importer now reserves an atomic, per-shop quota **before** querying Shopify's Admin API: 60 requests and 1,000 submitted ranking observations per fixed UTC hour. Requests from different shops do not share the quota. HTTP 429 includes a `Retry-After` value in seconds; invalid credentials receive HTTP 401. Failed Shopify domain checks and duplicate/retried submissions consume budget intentionally, so retries must be bounded and paced. The quota is durable in `StoreConfig`, is deleted on uninstall/redaction, and does not reset when an operator rotates a key.

This is a defensive app policy, **not** Shopify's GraphQL Admin API throttle (which is calculated using query cost and app/store buckets), a Bright Data billing cap, a verified source signature, or protection from unauthenticated network floods. Before enabling a real merchant connector, add ingress/IP abuse limits, source attestation, per-merchant paid scrape spend ceilings, and real payload/429/backoff tests.

Source: https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits


## Editorial readiness score: scope and limitations (2026-10-27)

The Blog Agent's stored `seoScore` is a **local structural triage score**, not
a prediction of Google rankings, a verified SEO audit, or a factual-quality
rating. A score of 70 only routes a draft into the human-review queue. It
**never** authorizes publishing. The UI should continue to describe it as
structural quality, not SEO performance.

The old heuristic gave 30 points for reaching 450 words and 10 points for
having at least one hyperlink. Both incentives were removed. Google's
people-first guidance explicitly says it has **no preferred word count**.
A hyperlink can be fabricated or unrelated, so link presence cannot establish
source reliability. The revised 100-point triage checks a clear title (25),
useful excerpt (20), minimally readable body (25), section/paragraph structure
(15), and topic relevance (15). The body-text minimum is an anti-empty guard,
**not** an SEO word target; a missing body, title, summary or placeholder
content caps readiness at 40. All draft links, product facts, originality and
claims still require human verification.

Regression cases cover a substantive draft under 450 words, unchanged scores
when unverified links are added, heading-only/empty content, placeholder text,
and sanitization of unsafe HTML. No claim is made that the score correlates
with merchant acceptance, conversion or search outcomes. In a consented pilot,
compare triage scores to blinded editor decisions and correction minutes; if
calibration fails, remove the score from the merchant UI rather than tuning it
to maximize content output.

Primary reference:
https://developers.google.com/search/docs/fundamentals/creating-helpful-content


## Streamed ingestion resource bounds (2026-10-27)

The n8n article callback (`POST /api/agent/complete`) now enforces **150,000 received bytes** and the SERP connector (`POST /api/seo/rankings`) enforces **75,000 received bytes** *while consuming the request stream*. Previously both routes called `request.text()` first and checked the size only after the entire body had been buffered; an absent or dishonest `Content-Length` could defeat the intended memory bound. Oversized requests return HTTP 413 without parsing JSON or invoking Shopify/Prisma. The limits count UTF-8 bytes, not JavaScript string characters, and are tested with chunked bodies, misleading headers, multibyte Unicode and exact-boundary payloads.

This is an application-level defense aligned with [OWASP API4:2023 Unrestricted Resource Consumption](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/). It does **not** replace reverse-proxy ingress body caps, per-IP request-rate limits, request read timeouts, n8n retry/backoff validation, memory/load testing or paid provider spend ceilings. Those remain mandatory staging and production gates. The workflow templates remain inactive; no merchant content is auto-published.


## Shared merchant erasure and PostgreSQL race verification (2026-10-27)

Both authenticated Shopify `app/uninstalled` and `shop/redact` webhook
handlers now call the same `eraseMerchantData(shop)` function. This prevents
future table additions from silently diverging between the two deletion paths.
The helper deletes `StoreConfig` **first**, inside one Prisma transaction,
because n8n article callbacks and ranking imports write-lock that row before
inserting any merchant-owned records. The other merchant tables are deleted
before commit. Retried webhook deliveries are idempotent.

`tests/merchant-redaction-postgres.test.ts` races two real article callbacks
against redaction across five independent synthetic shops using the PostgreSQL
CI service. It asserts no drafts, jobs, configuration, or editorial reviews
survive, that delayed callbacks are rejected, and that an unrelated merchant's
data remains intact. This is a **database-level concurrency test**, not a
Shopify-delivered webhook, live n8n integration, or guarantee about any future
writer that does not acquire the same merchant row lock. When adding a new
merchant-owned table or integration writer, update the shared helper and
verify the row-lock invariant.

Shopify's mandatory privacy webhook guidance:
https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

Prisma 6 transaction guidance:
https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions


## Search Console measurement-integrity checks (2026-10-27)

The daily organic import now verifies that Google actually returned
`responseAggregationType: "byProperty"` for the requested date-only,
property-level web report. A successful HTTP response with `byPage`, `auto`
or missing aggregation metadata is rejected rather than silently mixed into
merchant growth metrics.

Each daily row must contain exactly one valid Pacific calendar date within the
requested range and finite **numeric** clicks, impressions, CTR and average
position. The importer rejects missing/null/string metrics, contradictory
click/impression/CTR combinations (tolerance 1e-6 for floating-point
serialization), nonzero position without impressions, and zero position with
positive impressions. A legitimate zero-impression row may contain all-zero
metrics. An invalid response fails before any rows are persisted; the existing
sync lease is released for a later investigation/retry.

**Scope:** These are contract and consistency checks, not verification that
Google's underlying traffic figures are accurate, that the account has
sufficient property access, or that content caused a traffic change. The
strict response aggregation requirement must be tested against an authentic
consented Google Search Console export before production activation. No real
merchant data or conversion lift has been observed.

Primary API contract:
https://developers.google.com/webmaster-tools/v1/searchanalytics/query


## Single-dispatch generation guard (2026-10-27)

Every paid/credit-backed n8n blog generation now atomically transitions its own
`ContentJob` from `queued` to `running` **before** reading product context
or sending a webhook. Only the winning claim may send a request; concurrent
claims, completed jobs and cross-shop job IDs are rejected. Duplicate attempts
must **not** refund the original job's credit, because that work may still be
running. The original callback remains idempotent.

HTTP redirects and 5xx responses are treated as **uncertain delivery**, not
definitive rejection: a POST may have reached n8n even if its response was
unusable. These attempts remain reserved for reconciliation instead of being
replayed automatically. Plain HTTP is accepted only for exact local loopback
hosts; prefix tricks such as `localhost.evil.example` are rejected.

Tests exercise concurrent conditional claims, tenant isolation, completed-job
rejection and webhook URL validation. They do **not** yet prove an exactly-once
n8n execution under network partition, n8n workflow restart or process crash.
Before production, verify callback delivery, 3xx/4xx/5xx behavior, n8n
execution deduplication and operator reconciliation in a real isolated n8n
instance. Do not automatically retry ambiguous dispatches or enable scheduled
merchant content without approval.

Background: https://shopify.dev/docs/apps/build/apis/graphql-admin/implementing-idempotency
(Shopify's own idempotency guidance illustrates why concurrent duplicate
requests require a stable operation identity; it does not provide idempotency
for our n8n webhook).
