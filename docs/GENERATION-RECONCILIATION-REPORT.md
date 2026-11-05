# Read-only generation reconciliation triage

**Development-only; reviewed 2026-10-29.** This report is not an execution ledger and does not establish whether a merchant was billed, whether n8n accepted a job, or whether a credit should be refunded.

## Why it matters

A crash after the database's queued-to-running claim but before n8n accepts the HTTP request leaves an ambiguous job. A lost HTTP response, a proxy error or a failed workflow after its early 202 acknowledgment can leave the same symptom. Blind retrying risks duplicate paid generation; blind refunding risks inaccurate merchant credit accounting. Existing safety code deliberately avoids both. Operators need an exact, minimal-data queue inventory to locate cases for investigation.

## Operator use (no writes)

Run against an authorized application database with the existing Prisma environment configured:

```bash
npx tsx scripts/generation-reconciliation-report.ts
npx tsx scripts/generation-reconciliation-report.ts --details
```

The default JSON reports **exact database counts** of (1) version-1 queued jobs older than five minutes, (2) legacy/unknown queued versions, (3) running jobs without an update for 30 minutes, and (4) all dispatch-uncertain jobs. The optional `--details` mode returns at most ten oldest job IDs and their age per category. It explicitly marks truncated samples; counts are not sampled. Neither mode returns shop domains, merchant topics, generated content, upstream errors, tokens or credentials. Treat job IDs as internal metadata and restrict CLI output and database access.

The report never invokes Shopify, n8n or the recovery endpoint. It never dispatches, retries, cancels, publishes, refunds, or changes database rows. It does not expose an HTTP endpoint or grant any new Shopify permissions.

## Evidence-based operator procedure

1. For **recoverableQueued**, verify the outbox version and age; the existing authenticated recovery worker can independently claim these jobs with its atomic fence. This report does not trigger that worker.
2. For **manualQueued**, inspect migration history and original dispatch evidence. Do not infer a missing POST from the queued label alone.
3. For **staleRunning** or **uncertainDelivery**, correlate the exact job ID with restricted n8n execution history, workflow/version, early acknowledgment, model request, callback and database draft. A status or elapsed time is not a signed rejection receipt.
4. If evidence is missing, keep the credit reserved and escalate. Do not use the existing refund helpers as an ad-hoc administrative action. A durable signed acceptance/rejection ledger and carefully authorized reconciliation mutation are future work.
5. Record anonymized time-to-resolution and count of stranded credits in staging. Validate tenant isolation and log retention before any production use.

## Verification and limitations

Pure regression tests pin the cutoffs and the four mutually exclusive status/version predicates. The CLI needs a configured database to run; its counts have not been measured on merchant data. It does not detect a completed job missing its article, and cannot prove that n8n did not make paid model calls. The 30-minute threshold is advisory, not an SLA. Restricted n8n execution history may be incomplete or pruned.

**Impact hypothesis:** faster operator triage, fewer accidental duplicate paid calls and clearer credit reconciliation. No merchant incidents, time savings, revenue, retention or organic growth improvements have been observed.

Sources: [n8n execution history](https://docs.n8n.io/workflows/executions/all-executions/), [Shopify data minimization](https://shopify.dev/docs/apps/build/security/credentials-and-data/collect-only-the-data-you-need), [outbox recovery contract](OUTBOX-RECOVERY.md).
