# n8n execution persistence and merchant-data retention

**Reviewed 2026-10-29. Not a live deployment.** All five exported workflows remain inactive and use explicit per-workflow execution settings.

## Reliability finding and decision

n8n issue [#38551](https://github.com/n8n-io/n8n/issues/38551) documents zero-output workflows appearing stuck in `running` when successful execution data is not saved. The reporter reproduced 0/10 completed with `none` and 12/12 with `all` in an A/B/A experiment. A fix was merged upstream, but a 2026-10-26 report still observed the issue in n8n 2.44.6, and stated the fix was absent from 2.44.7. These are external reports, **not** our own integration results.

Our scheduler, manager, GSC sync and recovery workflows may legitimately receive an empty HTTP result or produce no useful downstream items. All five workflows therefore explicitly set:

- `saveDataSuccessExecution: "all"` to avoid inheriting a potentially unsafe global `none` setting on affected n8n versions and to preserve incident evidence.
- `saveDataErrorExecution: "all"` to retain failed-run diagnostics for reconciliation.
- `saveManualExecutions: false` and `saveExecutionProgress: false` to avoid extra manual-run and per-node persistence.

These are **temporary compatibility defaults**, not an assertion that n8n is fixed, exactly-once, or privacy-safe. Saving success/error data can persist merchant topics, product context, model prompts, generated articles, shop identifiers and response payloads. Workflow settings are not a substitute for instance-level security and data minimization.

## Required staging and privacy gates

1. Pin the exact n8n version and test both zero-item and normal-output runs on the actual instance. Check terminal status in the UI, API and database; do not infer correctness from a green webhook response. Once a patched release is proven, re-evaluate `saveDataSuccessExecution: "none"` with regression tests before reducing retained data.
2. Restrict execution-history access to authorized operators, isolate the instance, keep secrets in n8n credentials, encrypt backups, and prohibit merchant access to the editor, execution history and other tenants' data.
3. Configure and **verify** n8n instance-level execution pruning, e.g. `EXECUTIONS_DATA_PRUNE=true` and `EXECUTIONS_DATA_MAX_AGE=168` (seven days), subject to a documented retention/legal decision. n8n notes that running/waiting and annotated executions may not be pruned, and hard deletion is delayed. Validate actual deletion and backup retention with representative sensitive test data.
4. Never paste real merchant payloads into manual execution tests. Use synthetic fixtures. If debugging needs raw payloads, require explicit operator approval, least-privilege access and a short deletion window.
5. Reconcile ambiguous article dispatches using the app's durable job record plus authorized n8n evidence. Saving an execution is not proof that the intended callback completed or that no duplicate paid model call occurred.
6. Confirm commercial licensing, authorized Shopify development-store installation and a real n8n smoke test before activation. **Do not activate these workflows** as part of this change.

## Impact and limits

Expected benefits: fewer invisible/stuck scheduled executions on affected n8n versions and better support for diagnosing uncertain deliveries. Costs: larger n8n storage and a greater sensitive-data retention surface until pruning is verified. No live execution counts, support-time savings, merchant conversions or revenue lift were measured.

Sources: [n8n workflow settings](https://docs.n8n.io/build/manage-workflows/configure-workflow-settings/), [n8n execution data and pruning](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data/), [upstream issue #38551](https://github.com/n8n-io/n8n/issues/38551), [n8n settings schema](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/schemas/workflowSettings.yml).
