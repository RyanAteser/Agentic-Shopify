# Read-only pilot catalog observability

The authenticated catalog loader emits one structured JSON event per attempted catalog audit:
`{"event":"catalog_read","outcome":"success|failure","stage":"primary_domain|catalog_page|audit","version":1}`.

This is deliberately low-cardinality. **Do not add shop IDs, tokens, product URLs, GraphQL responses, exception messages, or customer details** to these events. Authentication failures occur before the catalog try/catch and must be monitored separately.

## Operator monitoring

Parse application stdout/stderr JSON lines and count `event=catalog_read` by `outcome` and `stage`. Alert on repeated failures in a bounded window, but only when there is sufficient traffic; zero events is not evidence of a healthy catalog. A successful empty catalog is still a success. The `stage` denotes the active operation when failure occurred, not a provider root-cause diagnosis.

Do not treat an HTTP 200 as a successful audit: the embedded merchant warning intentionally remains a normal loader response pending a hosted UX check. This change does not configure a hosted log collector, alert rule, or synthetic monitor.

## Verification gates

1. Run `npm test`, `npm run typecheck`, and production build in CI.
2. In an isolated authorized integration environment, inject a failed primary-domain read and a malformed catalog response; verify one failure event each, and the unchanged safe merchant warning.
3. Verify a successful empty catalog emits success; ensure no sensitive strings appear in logs.
4. Configure a collector/alert with retention and access controls, then test an actual alert before closing issue #8.

No merchant-store writes, new permissions, deployment or billing are required for this code change.

## Telemetry sink failure behavior

Structured logging is best effort: a throwing stdout/log collector must not turn a successful catalog read into a merchant-visible failure, nor prevent the safe unavailable result after a Shopify read error. The runner separates audit operations from event emission and catches only sink exceptions at the emission boundary. Regression tests exercise both outcomes. Monitor the log collector independently: absence of events cannot establish catalog health, and this safeguard does not verify hosted alert delivery.
