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

## Automated verification and production-image smoke (2026-10-28)

The recovered GitHub Actions run [40722675414](https://github.com/RyanAteser/Agentic-Shopify/actions/runs/40722675414) passed all three jobs (application tests/build, PostgreSQL migrations/tests/build, Docker image build) on commit `edfc2b0`. This demonstrates the previous runner-startup restriction is not blocking that run; it does **not** validate a real app installation.

The subsequent CI-only script `scripts/ci-container-smoke.sh` exercises the **actual production Docker image**, not just the Dockerfile: non-root execution, a temporary PostgreSQL container, committed PostgreSQL migrations executed from the image, HTTP `GET /health` returning 200 with the database available, and HTTP 503 after PostgreSQL stops. It uses inert Shopify configuration and local test-only credentials, with automatic Docker cleanup. The new smoke step must pass hosted CI before counting it as verified. It does not test merchant authentication, Google/n8n, a public HTTPS deployment, production secrets, backups, scale or rollback.

## Human editorial approval integrity (2026-10-28)

A usable review now stores a SHA-256 digest of the exact Shopify-bound article title, HTML body, excerpt, tags, destination blog ID and author name. Publication compares the digest **inside the same tenant-scoped database transaction** that claims the ready draft. A conditional status transition also checks those article fields so a concurrent edit cannot silently change the claimed payload. Changed content or destination, including a legacy review with no digest, blocks publication until the merchant explicitly reviews the current draft again. The Blog Agent exposes the outdated state and permits renewal; the Store Manager disables its publish control until the review is current.

This is an application integrity control, **not proof that a human read the content**, source verification, cryptographic attestation of a reviewer, or protection against a privileged database writer changing the Shopify article after publication. Re-review updates the existing shop/draft decision row rather than inflating review counts. Reject decisions remain final. No automatic publishing, new Shopify scopes, buyer data, or external services are introduced. Migration `20261028170000_editorial_review_content_digest` defaults existing reviews to an empty digest and intentionally requires renewed approval. CI must validate SQLite, PostgreSQL migration/tests and the Docker smoke before this is considered verified.

## Scheduled-draft delivery correctness (2026-10-28)

**Failure discovered:** the hourly scheduler advanced `nextRunAt` and `topicCursor` *before* creating a credited job. An exhausted free plan, a failed job insert or a definitive n8n rejection could silently consume a scheduled slot without delivering a draft. Exhausted stores remained in the first ten due candidates and could starve eligible merchants.

**Development fix:** `app/lib/scheduled-drafts.server.ts` now atomically reserves the due slot, one of the three lifetime free credits, the topic cursor and the queued job in a single short database transaction. It conditionally claims the exact schedule snapshot and verifies the row is still due. Quota-exhausted, disabled and future-due stores are excluded before the ten-store selection. A definitive pre-acceptance rejection marks the job failed, refunds exactly once and conditionally restores the original due slot/cursor. If the merchant changed schedule settings in the meantime, the new settings win. Transport timeouts, ambiguous HTTP responses and completed callbacks **never** trigger automatic refund, replay or schedule rewind. A restored due slot is considered only on a later hourly sweep; there is no immediate retry storm. The Blog Agent displays a free-quota pause explanation, without activating paid billing.

**Testing:** `tests/scheduled-drafts.test.ts` covers atomic claim, duplicate stale claims, topic order, refund/reclaim, uncertain outcome, merchant setting edits, quota-aware fairness and PostgreSQL concurrency/callback races. All tests are synthetic, using isolated temporary merchant records; hosted CI must pass before counting the new tests as verified.

**Merchant impact hypothesis:** fewer silent missed drafts, no duplicate paid generation on uncertain delivery, and more equitable scheduler capacity. Measure scheduled jobs that reach an actual reviewed draft, failure/reconciliation rate and merchant retention in an authorized pilot. No actual draft delivery, revenue, SEO or retention improvement has been observed.

**Remaining limitation:** A server crash after committing a queued job but before the n8n POST still leaves a queued job without a confirmed delivery. The existing 30-minute stale-job notice is advisory; a durable outbox/worker lease and operator reconciliation remain production gates. The scheduler is inactive until the n8n integration and commercial license are cleared.

## Durable queued-generation recovery (2026-10-28)

A new **opt-in, inactive** n8n recovery workflow and authenticated `POST /api/agent/recover` endpoint address the crash-after-commit/before-dispatch gap for **newly versioned** generation jobs. The recovery sweeper selects up to three jobs at least five minutes old and only if still `queued`; `claimQueuedDispatch` atomically fences concurrent workers before any n8n POST. Manual and scheduled job creation now persist `outboxVersion=1`; scheduled jobs also retain the original due-slot snapshot for a definitive rejection/refund. Legacy queued jobs default to version 0 and are never automatically replayed. Running/uncertain/completed jobs are never retried. A crash after the claim but before n8n acceptance remains unresolved and requires human execution-history reconciliation; this is not exactly-once delivery. See [OUTBOX-RECOVERY.md](./OUTBOX-RECOVERY.md) for the failure matrix, staging tests, license requirements and monitoring.

**Verification gate:** PostgreSQL migration, SQLite/PostgreSQL tests, TypeScript/build and Docker smoke must pass CI on the final branch head. A real authorized n8n/Shopify staging test and commercial license clearance are still required before activating the workflow. No production recovery, publishing or merchant benefit has been demonstrated.

## Merchant draft correction workflow (2026-10-28)

The Blog Agent now offers a server-validated HTML draft editor before human review. Corrections stay in the app's unpublished draft, are sanitized, version-checked against concurrent browser edits, and invalidate prior usable review approval atomically. The app does **not** publish, re-run n8n, or spend generation credits when a merchant saves corrections. See [editorial editing contract and pilot metrics](EDITORIAL-EDITING.md).

**Still unverified externally:** a real Shopify development-store article and theme, two-session browser conflict UX, accessibility, Shopify's 64 KB rich-text limit in GraphQL, and merchant-reported review-time savings. Do not infer SEO lift from the heuristic score or call the app production-ready based on CI.

## Browser-versioned final Publish confirmation (2026-10-28)

The existing stored human-review digest prevents publishing content without a **current usable review**, but a stale browser tab could still publish a different, subsequently re-reviewed version. Both Blog Agent and Store Manager now include a versioned SHA-256 confirmation fingerprint for the **publication payload visible at page render** (title, HTML, excerpt, tags, blog ID, author). The publisher checks it in the merchant-locked claim transaction before any Shopify mutation. A missing/stale fingerprint leaves the draft ready, requiring refresh and reinspection. See [EDITORIAL-EDITING.md](EDITORIAL-EDITING.md) for test cases, limitations and two-editor staging protocol.

**Verification status:** code committed; require passing SQLite/PostgreSQL CI, production build and Docker smoke on this final head. This is not merchant authentication, proof of reading, live Shopify behavior or exactly-once delivery. No permissions, publishing automation, billing or live merchant data are changed.

## SERP alert precision gate (2026-10-28)

Store Manager now requires two subsequent same-page snapshots that are
both at least three positions worse than a preceding baseline before creating
a ranking-drop recommendation. They need not worsen monotonically.
The three-point rule is conservative and read-only, with no Shopify edits or
additional Bright Data requests. It cannot establish actual traffic loss.
See [SEO-AGENTS.md](./SEO-AGENTS.md) for exact eligibility, false-positive
limitations and the consented merchant pilot. CI and real Bright Data
payload validation are still required; no observed merchant outcome is claimed.

## Recorded editorial decision elapsed time (2026-10-30)

The Growth dashboard now reports the median and nearest-rank 90th percentile of elapsed clock hours from draft creation to the **latest recorded editorial decision** for a complete, bounded 28-day creation cohort. It includes only explicitly reviewed drafts and requires at least five valid intervals; any future-dated or pre-creation review timestamp suppresses both percentiles. Duplicate/foreign decisions fail closed. It does not infer elapsed time for missing reviews, inspect article bodies, or introduce new permissions.

**Important distinction:** a merchant can edit and renew an earlier review, so `reviewedAt` is not a guaranteed first-decision timestamp. These are not time-to-first-review, human labor minutes, time savings, or a queue SLA. Selection bias remains because unresolved drafts are excluded. A genuine first-response latency metric requires a separate immutable event record of entering the review queue and initial decision, with an independently tested migration and merchant consent. The current 28-day creation-date cohort does not cover older actionable queues. Before claiming productivity gains, collect a consented baseline and compare quality-adjusted total human time and provider costs, including rejected and unresolved work.

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

### Search Console storefront property scope

The scorecard uses GSC `byProperty` date aggregation. A `sc-domain:example.com`
property includes **all subdomains and protocols**, including unrelated
sites on `blog.example.com` or `support.example.com`. It cannot establish
the traffic of a single Shopify primary storefront. Google documents this
coverage: https://developers.google.com/search/blog/2019/02/announcing-domain-wide-data-in-search

**New consent requires a verified `https://PRIMARY_HOST/` URL-prefix
property** (exact host, HTTPS, root path). Domain-only accounts must add and
verify that URL-prefix property in Search Console first. A valid URL-prefix
excludes other protocols and hosts, so the result is storefront-host scoped,
**not** total brand or all-channel organic traffic. Multi-domain Shopify
Markets and canonical redirects remain out of scope until separately verified.

Previously saved `sc-domain:` connections cannot import new observations;
the Growth page hides their historical totals and comparisons to prevent
false growth claims. Existing data are not silently deleted. The merchant
must explicitly disconnect (which erases the old token and metrics), then
reconnect the exact property. The new property has a different scope, so
**never splice its baseline with the old domain-wide history**. Tests use
synthetic Google responses; live property access and data accuracy remain
release gates.

### Search Console OAuth re-consent and measurement reset (2026-10-27)

**Reconnecting Search Console invalidates the previous local organic-metric
baseline, even when the new consent selects the same URL-prefix property.**
A previous implementation reset `lastSyncedAt` but retained the old daily
rows. Switching properties and later reconnecting to a previously used host
could immediately redisplay historical 28-day totals without a new Google
import, misleading the merchant about the current authorization and scope.

The OAuth state is consumed and the connection row is updated/locked before
deleting that shop's old `OrganicDailyMetric` observations, all in **one
database transaction**. Re-consent resets the connection timestamp, sync
lease and last-success timestamp. Invalid/expired OAuth state rolls back
without erasing measurements; other shops' rows are never touched. This
intentionally clears old **app-stored** metrics, not any data in Google Search
Console or Shopify. The merchant must import a fresh 56-day Google snapshot
before the growth comparison can resume. A disconnected merchant can use
the existing explicit disconnect flow to erase credentials and metrics.

Regression coverage exercises a different-property re-consent, same-property
re-consent, failed OAuth state and neighboring-merchant isolation. The
PostgreSQL concurrency and authentic Google OAuth flows still require
verification once hosted CI is available. No merchant data has been changed
by this code-only development update.

### Search Console date coverage and interpretation

Google Search Analytics reports calendar dates in **America/Los_Angeles**, not UTC; the import and comparison now share one DST-aware 56-day window excluding the three most recent Pacific dates. The API can omit dates with no search data, and even finalized data can arrive late. Do **not** turn missing API rows into zero clicks or compare a 21-day total to a 28-day total. The growth scorecard only displays a percentage change when both adjacent 28-day windows contain 28 unique daily observations; otherwise it shows coverage and abstains. This conservative rule means a genuinely zero-traffic day omitted by Google can prevent a scorecard from displaying a comparison. A future, separately audited coverage-provenance model is required before safely reporting complete zero-traffic periods.

**Snapshot reconciliation (2026-10-27):** On each *successful, validated* date-only Search Analytics response, the importer now deletes previously stored observations for dates that Google omitted **within the requested 56-day range**. It performs that deletion in the same shop/property-scoped transaction and consent/lease lock as the upserts. Previously, a stale date from an older response could continue to count toward the 28/28 coverage gate and create a misleading comparison. Empty valid responses retire all dates in that range; malformed responses do not modify stored metrics. Older dates outside the requested window and other shops are untouched. This is intentionally conservative: omission is not proof of zero clicks, and Google does not guarantee every data row is returned. A missing date causes the scorecard to abstain rather than imply a full baseline. Regression tests cover omitted dates, empty snapshots, invalid aggregation, later recovery, historical-range retention and tenant isolation. Live Google API behavior and PostgreSQL concurrency remain unverified on this increment.

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
The helper now deletes persisted Sessions **first**, then `StoreConfig`,
inside one Prisma transaction. This fences delayed authenticated page-load
and settings writes (which lock Session before creating config), while n8n
callbacks and ranking imports continue to lock the existing StoreConfig
before inserting merchant-owned records. Other merchant tables are deleted
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


## n8n delivery outcome and stalled-job runbook (development only)

The writer webhook's immediate HTTP 2xx response confirms intake, **not** completed generation or a saved draft. A later authenticated callback is required to mark a job completed. n8n's default Webhook response mode acknowledges before the workflow finishes: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/

- **2xx**: accepted for processing; await callback. A stale `running` job (30 minutes without an update) is shown as requiring review, not automatically marked failed.
- **Known permanent 4xx** (400/401/403/404/405/410/413/415/422): dispatch is rejected and the original job's reserved free credit may be refunded transactionally.
- **Other statuses** (including 408 timeout, 409 conflict, 425 too early, 429 throttling, redirects and 5xx), or transport exceptions: delivery is uncertain. Preserve the credit and job; **never auto-retry the same paid work**. A 429 may carry `Retry-After`, but that does not authorize retrying an ambiguous non-idempotent POST.
- **Manual reconciliation**: first verify the merchant shop and job ID, inspect the n8n execution and callback history for that exact ID, and compare the app's draft/job state. If n8n completed, reconcile the callback once through the authenticated, idempotent endpoint. If it demonstrably never accepted the request, an operator can design a separately audited resolution/refund process; none is automated today. Do not replay requests merely because a job is old.
- **Observability gap**: the 30-minute notice is advisory, not an SLA or proof of provider failure. There is not yet an operator dashboard, dead-letter queue, or authenticated n8n execution lookup. Test 408/409/425/429, 5xx, lost responses, delayed callbacks and execution retries against an isolated n8n instance before launch.

HTTP semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/408 and https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429 .


## Durable editorial review required before Shopify publication (2026-10-27)

A structural readiness score (even 100/100) must not authorize an irreversible
Shopify `articleCreate(isPublished: true)` mutation. Previously, the Blog Agent
and Store Manager allowed a single publish confirmation checkbox to publish a
`ready` draft without a separately recorded editorial review. The shared
publisher now requires a **shop-scoped, persisted `usable` editorial review**
for that draft, then atomically claims its `ready` status under the merchant
row lock. Both UIs disable or hide publication until the review is recorded.
A final explicit merchant confirmation is still required; n8n cannot publish.

Regression tests use a mocked Shopify Admin GraphQL client: unreviewed,
rejected, other-shop, and redacted drafts trigger **zero Shopify mutations**;
a reviewed draft triggers one publish mutation, and a repeat attempt cannot
publish twice. An ambiguous Shopify response leaves the draft in
`needs_reconciliation` and prevents a blind second mutation.

This is a workflow and database guard, **not proof** that a merchant actually
verified facts, that Shopify accepted a real publication, or that a concurrent
uninstall cannot occur after the local claim but before the external API call.
A real development-store test and reconciliation plan remain required.

Official Shopify `articleCreate` contract:
https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/articleCreate


## Verify Shopify publication visibility and destination (2026-10-27)

The shared publisher now captures the selected blog, author and reviewed draft
content inside its merchant-row-locked publication claim. A missing destination
blog is a **local validation failure**: no Shopify request is sent and the
reviewed draft remains ready for correction. This avoids placing a draft into
manual reconciliation when no external mutation could have occurred.

Shopify's `articleCreate` mutation response is requested with `article.id`,
`article.isPublished` and `article.blog.id`. The app marks an article
`published` only if the response has a nonempty ID, confirms
`isPublished === true`, identifies the blog selected at claim time, and has
no GraphQL or mutation user errors. Missing, unpublished, or wrong-blog
responses remain `needs_reconciliation` and cannot be blindly replayed.

Five synthetic mocked-Admin tests cover absent destination, unpublished
response, wrong blog, omitted visibility fields and a configuration change
while the mutation is in flight. These checks validate response handling, not
Shopify's real-world consistency, storefront visibility, indexing, or
uninstall races. An authenticated development-store test must verify the
exact 2026-10 GraphQL response and a live storefront before release.

Primary API contract:
https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/articleCreate


## Manager recommendation privacy race (2026-10-27)

A background Store Manager sync or an in-flight merchant page load can finish
reading product evidence after Shopify uninstalls the app. Previously,
`syncManagerTasks` wrote recommendations without checking the merchant's
continued existence, and `logStoreAction` could append audit entries after
the redaction transaction. These are potential post-deletion data re-creation
paths, not confirmed merchant incidents.

Both write paths now first update/lock the shop's `StoreConfig` row within
the same transaction as their merchant-owned writes. If that row has already
been deleted, sync returns zero and logging does nothing. If redaction starts
later, it waits for the row lock and deletes all writes before committing.
The lock order matches the shared `eraseMerchantData` routine, preventing
recommendations and activity from surviving an uninstall race.

Tests: `tests/manager.test.ts` covers delayed writes after deletion;
`tests/manager-redaction-postgres.test.ts` runs five synthetic concurrent
sync/log/redaction rounds against real PostgreSQL and checks isolation of an
unrelated merchant. No live store, webhook delivery, or external credentials
are used. PostgreSQL documents conflicting row-level locks:
https://www.postgresql.org/docs/current/explicit-locking.html .
Shopify's required shop redaction behavior:
https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance .

**Remaining limitations:** Real Shopify signed uninstall delivery, multiple
worker processes, slow Shopify API responses, tenant-wide deletion auditing,
and database backups/retention need development-store and operations testing.
The row lock does not prevent an already-started external Shopify API request;
no external calls occur inside these manager transactions. The test harness
must pass full CI before this change is considered verified.


## Authenticated page-load and uninstall race guard (2026-10-27)

Blog Agent initialization and settings save now require a matching persisted
Shopify Session row and lock it in the same transaction as StoreConfig writes.
Both uninstall and shop-redact erase Session before StoreConfig, so a delayed
authenticated GET or POST cannot recreate configuration after erasure. Added
SQLite lifecycle tests and a five-shop PostgreSQL bootstrap/save/redaction
race test. The lock order is documented in
[MERCHANT-SESSION-LIFECYCLE.md](./MERCHANT-SESSION-LIFECYCLE.md).

These checks do not prove real OAuth persistence, webhook delivery, or
Shopify SDK behavior with expired offline tokens. A development-store
install, idle-token expiry, uninstall, webhook HMAC and redaction test is still
required before launch. No live merchant stores or content were touched.

## Search Console fail-closed response and permission checks (2026-10-27)

Google's Search Analytics API can omit `rows` entirely when no data exists;
that is distinct from a malformed explicit `rows: null`, `false`, `0`, or `""`.
Previously the importer used `result.rows || []`, silently converting these
malformed HTTP 200 responses into a valid empty snapshot and deleting the
shop's previously verified observations for the 56-day import window.
The importer now accepts only a genuinely omitted `rows` field or an array;
malformed values fail before the consent-fenced database transaction and
preserve existing observations. A verified empty array or omitted field can
still clear stale dates within the requested shop/property/date window.

The Google property selector now accepts only documented verified permission
levels (`siteOwner`, `siteFullUser`, `siteRestrictedUser`). Missing, unknown,
and `siteUnverifiedUser` levels are rejected rather than treated as verified.
Regression tests reproduce both original defects and check recovery, tenant
isolation, and preservation of historical observations.

Primary references:
https://developers.google.com/webmaster-tools/v1/searchanalytics/query
https://developers.google.com/webmaster-tools/v1/sites

**Remaining gate:** These are mocked Google HTTP responses and local database
tests, not real Google consent, Search Console access, or merchant growth.
Validate an authorized Google property and live Shopify primary domain before
using this scorecard for merchant decisions. Hosted CI and PostgreSQL tests
must pass on the final commit before production readiness can be asserted.

## Hosted CI account-level blocker (confirmed 2026-10-27)

GitHub Actions run
[40635528606](https://github.com/RyanAteser/Agentic-Shopify/actions/runs/40635528606)
reported **zero billed runner milliseconds** for all three jobs. The `test`
check-run annotation explicitly states: *"The job was not started because
recent account payments have failed or your spending limit needs to be
increased."* The accompanying Ubuntu runner-image migration notice is not
the failure reason. This is a runner-dispatch/billing entitlement block, **not
a failing test or Docker build**. The account's actual billing state cannot
be inferred from the annotation alone.

The repository owner must inspect the personal account's **Settings → Billing
& plans** for failed/pending payments, included Actions minutes, and Actions
spending limits; if these are healthy, contact GitHub Support with the run URL
and exact annotation. Do not change billing/spending limits without explicit
approval. Once GitHub restores runner eligibility, rerun all three jobs and
require green SQLite, PostgreSQL, and Docker checks on the latest PR head.
GitHub reference: https://docs.github.com/en/actions/concepts/billing-and-usage

## Shopify article excerpt HTML boundary (2026-10-28)

The Blog Agent stores and displays `ArticleDraft.summary` as **plain text**,
but Shopify's `ArticleCreateInput.summary` is an **HTML** field. Sending
untrusted model-generated or imported excerpt text directly into that field
could allow markup and attributes to be interpreted by a storefront theme.
The shared publisher now HTML-encodes `& < > " '` **at the outgoing Shopify
mutation boundary**. The stored merchant excerpt remains unchanged; a literal
HTML entity remains literal instead of being decoded into markup. This affects
both Blog Agent and Store Manager publishing because they share the publisher.

Pure encoding tests cover markup, quotes, ampersands, Unicode and already
encoded entities. A mocked Shopify mutation regression asserts the exact
escaped summary sent to Admin GraphQL. This is defense-in-depth, **not**
a storefront XSS penetration test or proof of Shopify/theme sanitization.
The article body uses a separate allowlist HTML sanitizer; merchant factual
review and an explicit publication confirmation are still mandatory.

Shopify API reference:
https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ArticleCreateInput

Production gate: run the full Node/Prisma suite and a development-store
article preview under the selected theme. Hosted Actions may remain blocked
before runner execution; isolated pure-function checks do not establish
end-to-end publication safety. No live merchant article was published.


## Editorial approval time-of-check integrity (2026-10-28)

The Blog Agent now binds review submissions to the exact draft and destination visible when the review form was rendered. The server rejects stale/missing review-form fingerprints inside the merchant-locked transaction before recording a usable review or rejection. This prevents a stale browser approval from silently blessing newly edited content, or a stale rejection from discarding corrected content. The existing publisher-side content digest and explicit merchant publication confirmation remain mandatory.

The new fingerprint includes the editorial keyword even though Shopify's publication payload does not, because merchant edits to the keyword must not silently preserve an old review screen. This is an optimistic concurrency check, not cryptographic proof of merchant attention. See `docs/EDITORIAL-EDITING.md` and `tests/editorial-review-stale.test.ts`. A two-editor development-store browser test and final hosted CI are still required. No live store was modified.

Primary API reference: https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/articleCreate

## Editorial backlog age diagnostic (2026-10-30)

The authenticated Growth dashboard now reports counts of drafts created in its rolling 28-day cohort without an explicit editorial decision after 7 and 14 days, plus the age in whole days of the oldest unreviewed draft. The same shop-scoped, bounded 1,000-draft read and abstention behavior apply. The calculation excludes drafts with recorded reviews, including old reviews that may have become stale after edits; it therefore measures **missing recorded participation**, not actionable approvals, current content quality, merchant abandonment or merchant response time. Directly published historical drafts without a recorded review remain included in the missing-review counts. This intentionally avoids claiming they were awaiting a merchant decision. The data are observational, not evidence of reduced time to publication, SEO ranking improvements, sales or retention.

Hypothesis for consented pilots: merchants with many 14-day unreviewed drafts may benefit more from better review workflow than additional draft generation. Validate by measuring reviewed draft coverage and quality-adjusted labor per accepted draft over time, using merchant-level controls and without sending reminders or publishing automatically. No extra app permissions, content access or marketing messages were introduced.
