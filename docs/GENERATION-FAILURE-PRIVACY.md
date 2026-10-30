# Generation failure data minimization (development-only)

**2026-10-29.** This is a code-level privacy and trust safeguard, not a deployed production feature. All n8n workflows remain inactive. No Shopify content, store settings, billing, live execution or merchant data was changed.

## Problem

The manual and scheduled generation-credit refund paths previously persisted `String(error).slice(0, 400)` into `ContentJob.error`. The error can originate from Shopify, Prisma, n8n, a transport adapter or an unexpected exception. A character limit does **not** redact embedded store URLs, merchant information, request fragments, or credentials. This database field survives beyond the original failure and can appear in job-status surfaces or backups.

## Change

Both refund paths now call `safeGenerationFailureReason`, which emits only fixed messages. It recognizes unavailable verified Shopify product context, missing n8n configuration, missing blog selection, and the precise set of HTTP codes already treated as definitive n8n rejections. Unknown errors are classified generically. It never stringifies unknown objects, stores raw upstream messages, or attempts to redact arbitrary free text with brittle regular expressions.

The existing **definitive failure / uncertain outcome** boundary is unchanged. The formatter does not decide whether a refund is permitted. Ambiguous dispatches still retain their credits and require reconciliation. Scheduled slot rewind, store locking, tenant isolation and idempotent refund behavior are unchanged.

## Evidence and limitations

Synthetic tests verify the classifier against an error containing a private merchant URL and fake token, malformed n8n error messages, non-Error values and objects with throwing `toString`. Database tests exercise both manual and scheduled refund paths, assert that no injected payload is stored, and verify credit accounting. SQLite, PostgreSQL and container CI must pass before this is considered verified.

This change does **not** retroactively erase old error strings, sanitize all application logs, reduce n8n execution-history retention, or establish that no other fields store sensitive data. A separate authorized migration and retention review would be required to clean historical records, with care not to erase evidence needed for disputed or uncertain jobs. Error categorization trades some diagnostic detail for safer persistence; operators should use access-controlled traces and correlation IDs rather than raw payloads.

## Impact hypothesis and next test

Expected: lower unnecessary sensitive-data retention and fewer privacy/support risks, without altering free-credit refunds. This is not evidence of fewer incidents, higher conversion, SEO lift or revenue. On isolated staging, inject synthetic Shopify/Prisma/n8n errors with fake tokens; inspect persisted jobs, API responses and application logs; verify no payload leakage and correct refunds, then test uninstall redaction. Measure the fraction of failed jobs with safe categorical errors and reconciliation time, with denominators.

References:
- [Shopify: collect only the data you need](https://shopify.dev/docs/apps/build/security/credentials-and-data/collect-only-the-data-you-need)
- [Shopify privacy requirements](https://shopify.dev/docs/apps/launch/privacy-requirements)
- [n8n execution data retention and pruning](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data/)
