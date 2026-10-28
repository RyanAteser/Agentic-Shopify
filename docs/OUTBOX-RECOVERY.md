# Queued generation outbox: bounded recovery (development only)

**Status:** Code and inactive n8n workflow on draft PR #1. No production activation, merchant jobs, n8n executions, Shopify publication, or paid API calls were performed. Do not enable before the existing Shopify, n8n licensing, credential and deployment gates pass.

## Failure addressed

The scheduler and merchant UI create a credited `ContentJob` inside a database transaction, then POST the job to n8n. A process crash **after the transaction commits but before `claimQueuedDispatch`** leaves a job in `queued`, with its credit and (for scheduled jobs) its future schedule slot already reserved. This was a deterministic architectural gap, not a measured merchant incident.

Newly created manual and scheduled jobs have `outboxVersion=1`. Scheduled jobs also store an immutable JSON snapshot of the previous due date, new due date, topic cursor, destination blog, cadence and seed topics in `scheduleClaim`. Both fields are committed with the job and credit. Legacy jobs default to `outboxVersion=0` and are **never automatically recovered** because their pre-claim dispatch history cannot be established.

## Recovery behavior

The separate authenticated endpoint `POST /api/agent/recover` requires `X-Agent-Key: N8N_CALLBACK_SECRET` and a configured `N8N_BLOG_WEBHOOK_URL` and `N8N_OUTBOUND_KEY`. It returns only aggregate counters: `candidates`, `accepted`, `uncertain`, `rejected`, `raced`, `blocked`. No merchant names, product details, draft bodies, secrets, or credentials appear in its response.

Each sweep selects at most **three** jobs that are still `queued`, version 1, and at least **five minutes old**. It validates scheduled claim metadata before any dispatch. The existing `claimQueuedDispatch` performs a conditional `queued -> running` transition **before** Shopify product context, prompt assembly or HTTP I/O. Two overlapping sweepers cannot both send the same job. The existing n8n transport never automatically retries ambiguous outcomes or follows redirects.

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
