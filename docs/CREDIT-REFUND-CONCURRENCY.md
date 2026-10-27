# Credit refund, callback and merchant-erasure lock ordering

**Development-only verification (2026-10-27).** Do not treat this as a live n8n or Shopify integration test.

## Finding

Before this change, `failCreditedJob` updated a `ContentJob` row and
then decremented `StoreConfig.freeDraftsUsed` in the same transaction.
The n8n callback path (`persistArticleCallback`) acquires the
`StoreConfig` row lock **before** reading/updating the job. Shopify
uninstall/redaction also deletes `StoreConfig` first.

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
- Callback: merchant -> job -> draft.
- Refund: merchant -> job -> credit decrement on merchant.
- Redaction: delete merchant -> delete merchant-owned records.

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
