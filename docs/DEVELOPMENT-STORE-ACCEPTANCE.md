# Development-store acceptance protocol (operator-run, inactive by default)

**Status:** Not executed. This document is a release test specification, not evidence of merchant benefit or permission to install, publish, deploy, activate n8n, or spend money.

## Prerequisites and stop conditions

Use a specifically authorized **Shopify development store**, an isolated PostgreSQL database, a dedicated n8n instance with a confirmed commercial licensing position, and test-only credentials. Obtain separate approval before app installation, enabling workflows, making a Shopify article visible, or changing any live environment. Do not use a merchant's active store as a substitute. Record the Shopify shop domain, app commit SHA, migration version, n8n workflow versions, API version, operator, UTC timestamps and test artifact IDs in a private run log; redact credentials, buyer data and callback capabilities.

Stop immediately on tenant data leakage, unexpected published content, duplicate article creation, missing human review, credential exposure, or privacy deletion failure. Preserve evidence without retaining personal data.

## Acceptance matrix

| ID | Scenario | Required observation | Failure condition |
| --- | --- | --- | --- |
| A1 | Authorized app install and OAuth | Exact approved scopes; authenticated shop session; no cross-shop access | Extra scopes or session crossover |
| A2 | Create one manual generation | Exactly one charged generation and one draft tied to the initiating shop | Double charge, wrong shop or published article |
| A3 | Edit draft after approval | Prior approval invalidated; publication blocked until fresh review | Stale approval remains usable |
| A4 | Explicit reviewed publish in dev store only | Exactly one article at the selected blog, matching reviewed title/body and author | Unreviewed, wrong-blog or duplicate article |
| A5 | Simulate timeout after Shopify accepted request | Reconciliation required; no blind automatic repeat | Automatic duplicate article |
| A6 | Replay same n8n completion callback | Same draft identifier; no overwrite of merchant edits | Second draft or changed edits |
| A7 | Deliver wrong-shop or forged callback | Denied without record mutation | Any accepted cross-tenant write |
| A8 | Simulate n8n dispatch ambiguity | Operator-visible uncertain state; no automatic double charge/retry | Silent replay or false refund |
| A9 | Uninstall / redact with delayed callback | Target-shop data removed; delayed callback cannot recreate it; unrelated shop unaffected | Data resurrection or cross-shop deletion |
| A10 | Disable all workflows | No subsequent scheduled generation or publication | Any unapproved autonomous activity |

For A4, authorization to test publishing must be explicit even in a development store. If not approved, mark A4 and A5 **NOT RUN**, not passed. A9 must use disposable fixtures and must not remove any real merchant records.

## Evidence and release decision

Record each case as **PASS**, **FAIL**, **NOT RUN**, or **BLOCKED**, with UTC execution time, isolated test identifier, expected and actual result, sanitized logs, and the verifier. Require all mandatory cases PASS before changing the app's development-only status. A single failed security/privacy case is a release blocker. CI passing is necessary but does not replace these tests.

Merchant value is a **separate gate**: enroll consented merchants; predefine the unit of analysis, baseline, review-quality rubric, labor timing and failure accounting before observing outcomes. Report per-merchant useful drafts, accepted drafts, editing minutes, total provider cost and retention denominators. GSC clicks and impressions require verified matching properties and comparable windows; neither alone establishes incremental sales. Do not describe synthetic fixtures or staging actions as traffic, conversions or revenue.

## External references

- Shopify Admin GraphQL article creation: https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate
- Shopify app privacy requirements: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- n8n license: https://docs.n8n.io/sustainable-use-license/
- Google Search Console performance metrics: https://developers.google.com/webmaster-tools/v1/searchanalytics/query

Related: [SETUP.md](./SETUP.md), [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md), [OUTBOX-RECOVERY.md](./OUTBOX-RECOVERY.md).
