# Offline end-to-end financial staging validation

**Status:** Draft, synthetic local integration test. This is not a connected n8n/OpenAI/Shopify production run, not a paid billing claim, and not evidence of merchant revenue.

## What is exercised with real application code

The new \`tests/finance-staging-lifecycle.test.ts\` uses the same Prisma database models and production library calls as the application. It runs a temporary loopback-only fake n8n HTTP endpoint, never contacting OpenAI, Shopify, or a deployed n8n worker:

1. Create a synthetic test merchant and offline Session. Configure an operator-only $0.50 monthly allowance and $0.25 reservation.
2. Create a credited article job and call the actual queued-to-running dispatch claim. Require a durable $0.25 job claim before network transmission.
3. Send the actual authenticated HTTP request to a local mock n8n endpoint. It returns the pinned job/shop-scoped 202 acknowledgment, as a real n8n workflow would.
4. Attempt the article-complete route with a valid-looking but **wrong-job HMAC**. Require HTTP 401, no article, no usage receipts.
5. Post a *correctly job-signed* synthetic article+two token receipts to the actual action. Require HTTP 200, one draft, one writer receipt, one editor receipt, completed job, and duplicate callback idempotency.
6. Calculate read-only usage for the job creation month, and compare it with a mock model rate card. The observed token quote is rounded in cents; neither the rate card nor the token report is an invoice.
7. Compare immutable job reservation amounts with the monthly budget counter. A second claim exhausts its $0.50 allowance; a third claim is blocked and remains queued.
8. Simulate an incorrect 202 job acknowledgment. The HTTP outcome becomes uncertain, the existing reservation remains held and another claim is blocked.
9. Tamper with a synthetic month counter. The read-only budget report must throw instead of displaying a false remaining allowance.
10. Remove all synthetic merchant records through the same privacy eraser used for uninstall/redaction.

**Explicitly not tested here:** Shopify OAuth installation, real n8n execution or schedule, OpenAI's provider-side usage/billing, Bright Data, actual merchant revenue, internet latency, or production configuration. Tests must never be characterized as live payment or cost proof.

## Observation and accounting

The owner-only \`scripts/report-unit-economics.mts\` now shows a \`prospectiveDispatchBudget\` section in addition to the historical usage report. It shows budget policy configured/paused state, held cents, claim count, the difference from the *current* cap and whether claims exceed a lowered policy. Claim sums must exactly match monthly committed cents. A missing policy does not become a $0 bill. The policy is not an entitlement and none of these fields measures invoice-backed actual spend.

## Rollout gates before a live paid merchant

- Complete a real authorized Shopify development-store OAuth and end-to-end n8n request with owner-approved low cost/usage caps.
- Verify model response tokens and request identities from the provider's own usage records, then reconcile invoice amounts for the billing period.
- Enforce limits at the actual model request: model allowlist, input/output limits, client cancellation behavior, n8n retries, and provider project spend controls.
- Obtain an n8n commercial usage/licensing arrangement and measure cost of deployment, hosted jobs, support and SERP data.
- Refuse automatic retry on uncertain execution; maintain a manual incident reconciliation log.
- Stress test a non-synthetic, consenting merchant account. Only then evaluate paid plan entitlement changes.

The staging harness is a **quality gate for application state transitions**, not launch approval.
