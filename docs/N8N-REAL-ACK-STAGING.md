# Real n8n acknowledgment staging gate (offline CI)

**Status: experimental. No merchant approval or paid model access.**

This is a stronger integration test than our loopback fake server, but it is **not a full live Blog Agent test**.

## What runs

GitHub Actions starts pinned **n8n 2.46.7 stable** in Docker on a temporary, egress-isolated network and ephemeral SQLite volume.

The fixture generator uses ONLY the first three nodes from the existing Blog Agent workflow: Receive Draft Request, the unchanged Prepare Brief Code node, and Acknowledge Job Acceptance. It severs the connection to the paid Draft Article node. No model calls, callbacks, schedulers, remote URLs, or paid external API nodes are present.

The CI fixture modifies the webhook path to ci-only-blog-ack and disables its credential requirement **only in CI**, because the temporary workflow has no credential store. The real production workflow remains configured with header authentication and stays inactive.

The real engine must accept a synthetic valid job and respond with exactly HTTP 202 and the echoed job/shop pair. An invalid capability must never be accepted with HTTP 202. Supplied attacker callback URLs must not appear in its response.

The Docker network uses the internal setting to prevent outward requests. Only a loopback port on the ephemeral CI runner is exposed.

## What does not run

- Shopify OAuth or real store product reads.
- OpenAI generation or editor calls.
- Signed provider usage receipts, invoicing, actual subscription charges or returns.
- Any public network webhook, merchant store mutation or article publication.
- Production commercial n8n execution, commercial licensing or model project budget.

The source n8n workflows remain inactive. Only the three-node fixture is published inside the disposable runner container.

## How to run

On an authorized Docker-capable machine with ability to pull the public n8n container:

    bash scripts/ci-n8n-ack-smoke.sh

The developer desktop currently lacks Docker and an n8n executable, so the reproducible gate runs on GitHub-hosted Linux.

## Remaining gates

1. Authorized, appropriately licensed real staging n8n with credential-backed production header authentication.
2. Constrained actual OpenAI writer/editor request and authenticated job callback.
3. Provider usage and billed invoice reconciliation, including failed or uncertain calls.
4. Verified per-tenant dollar spending control across model provider, external research and workflow infrastructure.
5. Genuine merchant installation and approval workflow, Shopify subscription entitlement and privacy validation.

The pinned engine version was the latest stable release on November 9, 2026. Changing the version requires an intentional compatibility review.

## Compatibility regression found in real n8n

The first actual n8n 2.46.7 smoke returned HTTP 404 after a successful CLI import and publish. This exposed a missing stable webhookId on the original inactive Blog Agent webhook node. On n8n 2.x, API/CLI-imported webhook nodes without a webhookId can register legacy prefixed routes rather than the configured short path. A stable RFC 4122 UUID is now part of the original source node and required by the safe fixture generator and regression tests.

This is a previously untested compatibility fix, not evidence that any live customer webhook was broken: the workflow has never been activated for a public merchant. The next real-engine CI run must confirm HTTP 202 before this test is considered complete.
