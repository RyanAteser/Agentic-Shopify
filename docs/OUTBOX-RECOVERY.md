# Queued generation outbox: bounded recovery (development only)

**Status:** Code and inactive n8n workflow on draft PR #1. No production activation, merchant jobs, n8n executions, Shopify publication, or paid API calls were performed. Do not enable before the existing Shopify, n8n licensing, credential and deployment gates pass.

## Failure addressed

The scheduler and merchant UI create a credited `ContentJob` inside a database transaction, then POST the job to n8n. A process crash **after the transaction commits but before `claimQueuedDispatch`** leaves a job in `queued`, with its credit and (for scheduled jobs) its future schedule slot already reserved. This was a deterministic architectural gap, not a measured merchant incident.

Newly created manual and scheduled jobs have `outboxVersion=1`. Scheduled jobs also store an immutable JSON snapshot of the previous due date, new due date, topic cursor, destination blog, cadence and seed topics in `scheduleClaim`. Both fields are committed with the job and credit. Legacy jobs default to `outboxVersion=0` and are **never automatically recovered** because their pre-claim dispatch history cannot be established.

## Recovery behavior

The separate authenticated endpoint `POST /api/agent/recover` requires `X-Agent-Key: N8N_CALLBACK_SECRET` and a configured `N8N_BLOG_WEBHOOK_URL` and `N8N_OUTBOUND_KEY`. It returns only aggregate counters: `candidates`, `accepted`, `uncertain`, `rejected`, `raced`, `blocked`. No merchant names, product details, draft bodies, secrets, or credentials appear in its response.

Each sweep selects at most **three** jobs that are still `queued`, version 1, and at least **five minutes old**, with **at most one oldest eligible job per merchant**. A database aggregate orders shops by their oldest eligible job, then selects one job from each shop. This avoids a single large merchant backlog consuming every slot; no fixed-size oversampling is used. It validates scheduled claim metadata before any dispatch. The worker now completes fallible Shopify product discovery, database prompt-history reads and prompt assembly **before** `claimQueuedDispatch` changes `queued -> running`. The claim then atomically checks the same merchant blog, audience, voice, topics and author used for the prepared brief, under the store-row lock. Two overlapping sweepers may perform redundant read-only preflight, but only one can claim and send the paid n8n POST. No Shopify or n8n network request occurs between a successful claim and the n8n POST. The existing n8n transport never automatically retries ambiguous outcomes or follows redirects.

| Observed state / outcome | Action |
|---|---|
| Version 1, aged, still queued | Eligible for one atomic claim and a single n8n POST |
| Fresh queued or version 0 legacy queued | No recovery; operator inspects legacy jobs |
| Running, completed, failed or dispatch_uncertain | Never replay |
| Verified pre-POST failure | Mark failed and refund once; scheduled jobs conditionally restore the due slot using stored snapshot |
| **Any non-2xx after attempted POST** (including 400/401/403/404/422), timeout, redirect or lost response | Keep credit; mark uncertain when possible; inspect n8n before manual reconciliation |
| Concurrent callback or another worker wins | No refund, replay or status overwrite |
| Corrupt schedule snapshot | No dispatch; atomically quarantine to version 0 while preserving queued status, credit and error evidence; operator investigates |

**Important boundary:** A crash *after* `queued -> running` but *before* n8n accepts the POST remains ambiguous to an external observer and is **not** auto-replayed. Exactly-once delivery across PostgreSQL and n8n is not claimed. A future n8n-side idempotency/acknowledgment protocol keyed by `jobId`, with durable execution lookup, is needed to safely reconcile that interval. The endpoint does not automatically publish articles.

## Correlated early n8n acceptance acknowledgment (2026-10-28)

The blog-writer workflow now switches from a generic `onReceived` response to a dedicated **Respond to Webhook** node immediately after `Prepare Brief`, before the paid drafting HTTP request. It returns HTTP **202** with JSON `{"accepted":true,"jobId":"...","shop":"..."}` taken from the authenticated input. The node passes its input forward to the drafting stage. The app accepts delivery only when the 202 JSON response exactly echoes the dispatched `jobId` and `shop`. The app bounds the response to 2 KiB and rejects wrong content types, missing bodies, malformed JSON, mismatched IDs and generic 200/204 successes.

**Safety rule:** Every missing, malformed, mismatched or unreadable 2xx acknowledgment is **uncertain**. The job retains its credit and is never automatically retried, failed or refunded. A callback that already completed the job wins over any late ambiguous HTTP response. This prevents a proxy's generic success response or the wrong n8n execution from being mistaken for acceptance. It does not change the merchant's manual publishing gate.

**What this does not prove:** n8n's early HTTP 202 is **not** durable execution persistence, paid-work completion, deduplication or an exactly-once delivery guarantee. A crash between `queued -> running` and n8n acceptance remains a manual reconciliation case. An early 202 followed by a failed workflow still needs monitoring and operator handling. A signed/durable n8n-side execution ledger keyed by tenant + job ID and an authenticated reconciliation endpoint remain future work. This change is not activated on any n8n instance and must be validated with a real n8n test webhook before enabling.

**Upgrade requirement:** Deploy the matching app and import the updated inactive writer workflow together. The old writer returns a generic response and will now cause safe `dispatch_uncertain` results. Never enable a mixed-version rollout without staging verification. Official n8n documentation: [Webhook response modes](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/#respond), [Respond to Webhook behavior](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/).

## Opt-in n8n setup (not performed)

1. Confirm commercial rights to operate n8n for configurable merchant automations. Written clearance or an appropriate Enterprise/OEM agreement is a launch gate; do not infer rights from source availability.
2. Import `n8n/shopify-queued-recovery.json` into an authorized n8n instance. It is **inactive by default**. Replace the placeholder app host and use a dedicated Header Auth credential in n8n's credential store; never put the key in workflow JSON.
3. Verify Shopify development-store install, tenant redaction, n8n webhook mapping, server-side secret rotation, rate limiting, and staging migrations before enabling the workflow. The recovery workflow's suggested 10-minute interval is not a production SLA.
4. Run failure-injection in staging: crash immediately after queued commit; two concurrent recovery sweeps; callback during sweep; lost HTTP response; 4xx after workflow acceptance; pre-POST validation failure; corrupt metadata; revoked merchant; database outage.
5. Instrument counts of eligible queued jobs by age, successful n8n acknowledgments, callback completion latency, reconciliations, refunds, abandoned credits, useful reviewed drafts, and merchant support incidents. Track counts by tenant internally with access controls, never leak cross-merchant data. Do not call job dispatches revenue or conversion growth.

## Rollback and migration

PostgreSQL migration `20261028190000_queued_dispatch_outbox` adds nullable `scheduleClaim`, `outboxVersion` default 0, and an indexed bounded sweep predicate. Existing jobs remain unchanged and ineligible. The local SQLite schema mirrors the fields. The recovery workflow can be disabled without losing jobs. Rollback must not delete evidence for running/uncertain work; investigate n8n execution history before any manual replay or refund.

**Sources:** [Prisma v6 transaction and OCC guidance](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions); [n8n execution history and manual retries](https://docs.n8n.io/workflows/executions/all-executions/); [n8n commercial licensing](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case).

**Impact hypothesis:** fewer credited jobs stranded by a crash-before-claim, less merchant waiting and fewer support tickets. No merchant traffic, sales, retention, organic ranking, editing-time or incident reduction has been measured. This is reliability infrastructure, not a demonstrated growth feature.


## Merchant automation changes fence queued scheduled drafts (2026-10-29)

A merchant can disable scheduling or change the destination blog, cadence, topics,
audience, brand voice or author after a due slot has been reserved but before the
outbox worker dispatches it. Previously, the queued job could later run using
the new configuration with its old topic, even after scheduling was disabled.

The merchant settings transaction now marks **only version-1, still-queued
scheduled jobs** failed with a cancellation explanation and refunds their
reserved free-generation credits exactly once. Manual generation requests are
not canceled when scheduling is disabled. Saving identical settings leaves
queued work intact. When scheduling stays enabled and a queued scheduled
draft is canceled, the due date resets to the present so the **next**
scheduler sweep can reserve a replacement with updated merchant settings;
the settings save itself does not dispatch any work. The dispatch claim takes a store-row lock before the
job-row transition, matching the merchant-settings lock order; a settings
change that commits first prevents the old scheduled job from being sent.
A claim that wins first is already `running` and cannot safely be canceled
or refunded: n8n may already receive the request. A disabled store also
cannot claim a leftover queued scheduled job. This is a **pre-dispatch
cancellation fence**, not a guarantee that disabling scheduling stops work
already in flight.

Regression tests cover disable/refund, idempotent repeated saves, preserving
manual queued jobs, content-brief changes, and a PostgreSQL claim-vs-disable
race. The result is a trust/reliability hypothesis, not measured merchant
retention or avoided AI spending. Do not activate scheduling or recovery
until real Shopify/n8n staging and commercial licensing gates pass.


## Stale scheduler brief snapshot guard (2026-10-29)

The due-job scheduler first reads eligible store configurations, then attempts a
transactional claim. A merchant may edit audience, brand voice or author between
those steps without changing the due date, seed topics, cursor, cadence or blog.
Previously, the claim predicate did not check those three brief fields. In
particular, when seed topics were empty, an old audience could be embedded in a
newly reserved topic despite a merchant's intervening edit.

The conditional claim now matches **audience, brand voice and author** alongside
the existing scheduling fields. A stale candidate returns no claim, creates no
job and consumes no credit; a later sweep can read the current brief and reserve
a fresh job. This is a database-level compare-and-set fence, not a network
cancellation guarantee. A job already claimed for dispatch is still subject to
the in-flight limitation above.

Regression coverage separately changes each brief field after a due candidate
is read, checks that the stale candidate cannot reserve a credit, then verifies
a fresh candidate can proceed. The change is not evidence of merchant growth;
a real two-session Shopify staging race and n8n integration remain release gates.

## n8n execution-history compatibility and retention (2026-10-29)

All five inactive workflow exports explicitly retain successful and failed production executions, disable manual-run and per-node-progress persistence, and require instance-level pruning. This avoids inheriting an upstream n8n zero-output stuck-running bug on affected releases but increases the sensitive-data retention surface. See [N8N-EXECUTION-DATA.md](N8N-EXECUTION-DATA.md) for evidence, privacy controls, version checks and staging go/no-go criteria. No workflows were activated.

## Pre-dispatch context failure and merchant brief race (2026-10-29)

A previously overlooked failure window existed **after** a job became `running` but **before** its n8n POST: reading rejection history, prior published titles, or Shopify product context could fail. The recovery worker deliberately never retries `running` jobs, so such a failure could leave a free credit reserved with no n8n execution. The merchant could also edit editorial settings while a worker prepared an older brief.

The worker now prepares read-only context first, then claims the job using a compare-and-set check on the destination blog, audience, brand voice, seed topics and author. A preflight failure cannot strand a `running` job; callers can safely mark it failed/refund under their existing transaction rules. A stale brief leaves the job queued for a fresh recovery sweep, with no n8n POST or extra credit. Already-running jobs remain non-replayable. The post-claim/pre-POST crash window still exists and requires operator reconciliation; this does **not** establish exactly-once delivery.

Regression coverage changes each editorial field between preflight and claim and verifies no state transition until a matching snapshot is provided. Production staging must additionally inject failures in Shopify product discovery and database history reads, test concurrent merchant settings changes, and verify no duplicate paid n8n execution. Expected impact is fewer stranded credits and off-brief drafts; no merchant-level incident reduction has been measured.


## Merchant-fair recovery selection (2026-10-29)

**Failure mode:** A global oldest-three selection could spend an entire sweep on one merchant with many old queued jobs. Other merchants' reserved free credits could wait through repeated sweeps even though they had eligible work. Shopify documents app/store-specific GraphQL query-cost budgets, but those independent upstream rate limits do not prevent starvation in our shared application outbox ([Shopify rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)).

**Implementation:** Group eligible jobs by `shop` in the database, order groups by their oldest eligible `createdAt`, and take at most three groups. Read the oldest eligible job from each selected shop, then use the existing atomic claim and no-retry policy. The sweep still sends at most three jobs, but never more than one from any merchant. Prisma v6 supports aggregate ordering with `groupBy` and `take` ([Prisma aggregation reference](https://www.prisma.io/docs/orm/v6/prisma-client/queries/aggregation-grouping-summarizing)).

**Regression scenario:** Five old jobs from merchant A plus one each from B, C and D. The first sweep must select A/B/C, not three A jobs. The second sweep must give D a slot while A still has a backlog. Existing tests retain the three-job limit and concurrent claim protections. Tests use local databases and injected dispatch callbacks; they do not call n8n or Shopify.

**Limitations:** This is oldest-merchant-first fairness, not strict round-robin or a per-merchant throughput SLA. A merchant with the oldest backlog can still receive one slot every sweep. Grouping and per-shop reads add database work; benchmark with realistic multi-tenant backlogs before production. Concurrent sweepers may choose the same shop, but the job-level compare-and-set prevents duplicate dispatch of the same job. No observed merchant wait-time reduction or retention gain is claimed.


## Pre-claim callback fence (2026-10-29)

The authenticated n8n article-completion endpoint previously accepted a callback
for a job that was still `queued`. That violates the durable outbox invariant:
our application must transition `queued -> running` **before** its one n8n POST.
A delayed or misrouted execution holding the shared callback credential could
otherwise create a draft for work that had never been claimed for dispatch.
This was a code-level trust-boundary defect, not evidence of exploitation.

The callback now accepts only `running` or `dispatch_uncertain` jobs for first
completion, plus `completed` for idempotent replay. `queued`, `failed` and
unknown jobs fail closed (HTTP 409 for a known wrong-state job). Rejected
callbacks create no article and leave the reserved credit and queued job intact,
so an authorized recovery sweep can still claim the work. The completion
transaction no longer lists `queued` as an eligible state transition.

Regression coverage creates a real credited version-1 queued job, verifies a
premature callback is rejected with no draft or credit change, then claims the
job and confirms normal completion and idempotent replay. A legitimate n8n
callback cannot precede the dispatch claim; the app claims before sending the
webhook. **This is not callback-level proof of execution provenance:** the
shared secret and job identifiers still need secure storage, rotation, staging
verification, and ideally a signed per-job execution receipt. No workflow or
store was activated and no merchant outcomes have been observed.

Evidence: [n8n execution records](https://docs.n8n.io/workflows/executions/all-executions/)
can support operator investigation, but do not themselves establish exactly-once
cross-system delivery. Staging must verify that callbacks from a real n8n
execution are accepted after claim and that out-of-order/duplicate callbacks
cannot create phantom drafts.


## Per-job article callback capability (2026-10-29)

The shared n8n bridge secret previously authorized all article-completion callbacks. A misconfigured writer or a leaked shared credential could submit a guessed or disclosed job ID for another merchant once that job had been claimed. The writer now receives only a deterministic HMAC-SHA256 capability bound to the exact `shop` and `jobId`. The app-only `ARTICLE_CALLBACK_SIGNING_KEY` is separate from `N8N_CALLBACK_SECRET`, and the callback route **never** accepts the global bridge credential as a fallback. The n8n writer propagates the capability as an HTTP header without exposing the signing key or passing the capability into the model prompts. Existing queued jobs can be prepared with the new capability on dispatch; already-running jobs on an old workflow require operator reconciliation rather than an insecure compatibility bypass.

This is job-scoped authorization, **not** proof that the model ran, that the n8n execution completed, or that a captured token cannot be replayed. Existing completed callbacks are idempotent. The capability can appear in n8n saved execution data, so operator access, retention and pruning are mandatory. Rotating the signing key invalidates outstanding callbacks; reconcile in-flight jobs first. The workflow remains inactive pending staging tests of real n8n expression headers, exact callback responses, wrong-shop/job rejection, retry behavior and secret rotation. No merchant traffic or avoided incident count was measured.

Security context: [Shopify authenticate every request](https://shopify.dev/docs/apps/build/security/app-server/authenticate-every-request), [n8n security audit](https://docs.n8n.io/hosting/securing/security-audit/).


## No status-only credit refunds after n8n POST (2026-10-29)

**Finding:** The dispatcher previously treated HTTP 400, 401, 403, 404, 405, 410, 413, 415 and 422 as *definitive* n8n rejections and automatically refunded a reserved generation credit. But an HTTP error returned after an attempted POST is not a durable, job-specific receipt proving that n8n never began the workflow. An intermediary or workflow can return an error after some work has already started. A delayed article callback could then race a refunded job, causing a false failed state, duplicate spending opportunities or merchant support disputes. This is a failure-mode analysis, not evidence of a real incident.

**Change:** After an attempted POST, **all non-2xx statuses** are classified as `dispatch_uncertain`, even apparently permanent 4xx responses. As before, any 2xx response must contain the exact 202 JSON acknowledgment matching `shop` and `jobId`; otherwise it is also uncertain. No automatic replay, credit refund, or schedule rewind occurs for uncertain jobs. Known failures **before** an n8n POST (missing configuration, verified product-context failure, invalid URL, preflight errors) can still fail and refund under existing store-row locks. An authenticated callback may still complete an uncertain job once, without changing its reserved credit.

**Tradeoff:** A genuine authentication failure or bad webhook path may now strand a credit until an operator checks the n8n execution log. This is intentional conservatism, not a complete billing solution. A future signed, durable *rejection-before-work* receipt and an authenticated reconciliation ledger could permit safe automatic refunds. A status code or response body without that guarantee cannot. Never assume the 202 acceptance acknowledgment proves completion.

**Regression plan:** For every previously refundable 4xx, use an isolated HTTP stub to assert exactly one POST, `dispatch_uncertain` state, no refund, and no retry. Verify a valid late callback after HTTP 400 still completes once. Run both SQLite and PostgreSQL CI. In authorized staging, inject a proxy 400 after webhook acceptance, confirm execution-history correlation, and measure false uncertain cases and time to reconcile. Do not deploy or activate workflows for this test without approval.

**Impact hypothesis:** Lower risk of false credit refunds and duplicate model expenditure, with potentially higher manual reconciliation workload. No merchant-level incident reduction, retained revenue, draft acceptance or SEO lift has been measured. Reference: [n8n execution history](https://docs.n8n.io/workflows/executions/all-executions/), [n8n Webhook and Respond to Webhook behavior](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/).
