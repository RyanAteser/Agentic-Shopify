# Credit refund, callback and merchant-erasure lock ordering

**Development-only verification (2026-10-27).** Do not treat this as a live n8n or Shopify integration test.

## Finding

Before this change, `failCreditedJob` updated a `ContentJob` row and
then decremented `StoreConfig.freeDraftsUsed` in the same transaction.
The n8n callback path (`persistArticleCallback`) acquires the
`StoreConfig` row lock **before** reading/updating the job. Shopify
uninstall/redaction now deletes persisted Sessions first, then `StoreConfig`
before deleting jobs; it still acquires the merchant row before the job.

If a definitive HTTP rejection/refund and a late callback execute
concurrently, the two transactions can acquire the same row locks in
opposite order. PostgreSQL may abort one with a deadlock error. This is
a **code-derived risk**, not a confirmed production incident.

## Change and invariant

`failCreditedJob` now first conditionally updates the merchant
`StoreConfig` row inside the refund transaction. It returns `false`
without touching the job if the shop has already been redacted. It
then conditionally changes only a `queued` or `running` job to
`failed`, and decrements exactly one reserved free credit if and only
if that status transition succeeds.

All three paths acquire the merchant row before the job row:
- Callback: merchant -> read job -> draft upsert -> job status update.
- Refund: merchant -> job -> credit decrement on merchant.
- Redaction: delete Sessions -> delete merchant StoreConfig -> delete jobs and other merchant-owned records.

The operation is idempotent: a completed job cannot be refunded, and
a failed job cannot be refunded twice. A network timeout, 408, 409,
425, 429, redirect or 5xx **must not call this refund path** merely
because delivery is uncertain.

## Verification

`tests/credits-postgres.test.ts` adds real PostgreSQL races:
1. Six independent shops each run a callback concurrently with a
   definitive rejection/refund. The only valid outcomes are a
   completed draft with one used credit, or a failed job with zero
   drafts and zero used credits. A second refund must be a no-op.
2. Four independent shops race a refund against merchant erasure.
   Neither operation may deadlock; no shop, job or draft may survive;
   a late refund must be a no-op.

Run with the existing CI PostgreSQL service:
`npx prisma migrate deploy --schema prisma/schema.postgresql.prisma`,
`npx prisma generate --schema prisma/schema.postgresql.prisma`,
then `npm test` with the PostgreSQL `DATABASE_URL`.
SQLite runs the ordinary tests but skips these PostgreSQL-only races.

## Limitations and release gate

These tests verify database lock ordering and state invariants, **not**
n8n acceptance, HTTP intermediary behavior, a real Shopify uninstall,
production throughput or a reduction in merchant costs. No live store,
billing, publishing or credentials are involved. Next: exercise the
same races with authenticated callbacks and simulated dropped n8n
responses in an isolated integration environment, then verify actual
Shopify development-store webhook delivery. Preserve the manual
publish gate and the n8n commercial licensing decision.

References:
- PostgreSQL deadlocks and consistent lock ordering:
  https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS
- Prisma 6 transactions:
  https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions


## Isolated HTTP transport fault injection (2026-10-27)

`tests/n8n-delivery.test.ts` runs the actual application dispatch transport
against a disposable local Node HTTP server; no n8n account, provider
credentials, Shopify Admin API, or live merchant data are used. The
`deliverClaimedN8nJob` helper is invoked only after an atomic job claim,
and the normal application dispatch still prepares Shopify context and
enforces the same webhook URL validation.

The regression suite verifies:

1. HTTP 202 acknowledges transport but leaves the job running until callback;
   the outgoing POST contains one job ID and the configured header credential.
2. HTTP 400 is a definitive rejection; the caller may refund exactly once.
3. HTTP 429 leaves the job/credit reserved; a later callback creates one draft
   and repeated callbacks cannot create duplicates.
4. A callback that commits before a delayed HTTP 503 response remains completed;
   uncertain-delivery bookkeeping cannot revert it.
5. Redirects are not followed, and a dropped TCP response is never retried;
   neither outcome automatically refunds a credit.

These tests are more representative than pure HTTP-status classification
tests, but **they are not a real n8n execution or a live Shopify callback**.
The stub cannot establish n8n's execution persistence, callback retry
configuration, provider charge timing, proxy behavior, or true crash recovery.
The release gate remains an authenticated, isolated n8n integration with
delayed callbacks, workflow-level execution lookup, and deliberate process
crashes. Never automatically retry an uncertain job without verifying that
the original n8n execution did not run.

References:
- n8n execution inspection and retry behavior:
  https://docs.n8n.io/workflows/executions/all-executions/
- n8n security audit for unprotected webhooks and credentials:
  https://docs.n8n.io/hosting/securing/security-audit/


## Uncertain dispatch plus database outage (2026-10-27)

**Invariant:** A failed write of `dispatch_uncertain` is not proof that the
outbound n8n request was rejected. Previously the write failure could escape
as a generic exception, and both manual and scheduled callers refunded generic
errors. If n8n accepted the job before returning HTTP 503, closing a socket,
or timing out, this could refund an actually running generation.

`deliverClaimedN8nJob` now always raises `UncertainDispatchError` after an
ambiguous HTTP or transport outcome, **even if recording that outcome fails**.
The error path logs only the exception class, not merchant payloads, tokens,
or endpoint URLs. Both callers must continue to exempt
`UncertainDispatchError` from `failCreditedJob`. A job may temporarily
remain `running` when the database write fails; that is preferable to
incorrectly refunding or dispatching twice.

The regression test uses a disposable local HTTP server to simulate HTTP 503
and dropped sockets while injecting a failed uncertainty-state database write.
It checks that the exception remains non-refundable, one request was sent, and
the original credit stays reserved. This is **not** a real n8n execution,
PostgreSQL outage, or proof of end-to-end recovery. In staging, induce a
database write outage after n8n receives a request, then verify operator
reconciliation against n8n's execution history and the stored job. Never
blindly replay a job because its status is `running`.

Reference: https://docs.n8n.io/workflows/executions/all-executions/
