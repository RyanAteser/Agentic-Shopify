# Queued generation outbox: bounded recovery (development only)

**Status:** Code and inactive n8n workflow on draft PR #1. No production activation, merchant jobs, n8n executions, Shopify publication, or paid API calls were performed. Do not enable before the existing Shopify, n8n licensing, credential and deployment gates pass.

## Failure addressed

The scheduler and merchant UI create a credited `ContentJob` inside a database transaction, then POST the job to n8n. A process crash **after the transaction commits but before `claimQueuedDispatch`** leaves a job in `queued`, with its credit and (for scheduled jobs) its future schedule slot already reserved. This was a deterministic architectural gap, not a measured merchant incident.

Newly created manual and scheduled jobs have `outboxVersion=1`. Scheduled jobs also store an immutable JSON snapshot of the previous due date, new due date, topic cursor, destination blog, cadence and seed topics in `scheduleClaim`. Both fields are committed with the job and credit. Legacy jobs default to `outboxVersion=0` and are **never automatically recovered** because their pre-claim dispatch history cannot be established.

## Recovery behavior

The separate authenticated endpoint `POST /api/agent/recover` requires `X-Agent-Key: N8N_CALLBACK_SECRET` and a configured `N8N_BLOG_WEBHOOK_URL` and `N8N_OUTBOUND_KEY`. It returns only aggregate counters: `candidates`, `accepted`, `uncertain`, `rejected`, `raced`, `blocked`. No merchant names, product details, draft bodies, secrets, or credentials appear in its response.

Each sweep selects at most **three** jobs that are still `queued`, version 1, and at least **five minutes old**. It validates scheduled claim metadata before any dispatch. The worker now completes fallible Shopify product discovery, database prompt-history reads and prompt assembly **before** `claimQueuedDispatch` changes `queued -> running`. The claim then atomically checks the same merchant blog, audience, voice, topics and author used for the prepared brief, under the store-row lock. Two overlapping sweepers may perform redundant read-only preflight, but only one can claim and send the paid n8n POST. No Shopify or n8n network request occurs between a successful claim and the n8n POST. The existing n8n transport never automatically retries ambiguous outcomes or follows redirects.

| Observed state / outcome | Action |
|---|---|
| Version 1, aged, still queued | Eligible for one atomic claim and a single n8n POST |
| Fresh queued or version 0 legacy queued | No recovery; operator inspects legacy jobs |
| Running, completed, failed or dispatch_uncertain | Never replay |
| Definitive permanent n8n rejection / pre-network failure | Mark failed and refund once; scheduled jobs conditionally restore the due slot using stored snapshot |
| Timeout, HTTP 408/409/429/5xx or lost response | Keep credit; mark uncertain when possible; inspect n8n before manual reconciliation |
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
4. Run failure-injection in staging: crash immediately after queued commit; two concurrent recovery sweeps; callback during sweep; lost HTTP response; definitive rejection; corrupt metadata; revoked merchant; database outage.
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
