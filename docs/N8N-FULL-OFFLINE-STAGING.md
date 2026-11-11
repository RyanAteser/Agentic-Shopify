# Full Blog Agent workflow, real n8n with offline provider mocks

**Status:** Draft integration gate. No Shopify merchant store, actual OpenAI endpoint, invoice, production credential, paid subscription, or live n8n service is used.

This builds on the acknowledgment-only real-engine gate in PR #22. That test proved n8n could receive the webhook. It did **not** prove the later six nodes executed correctly.

## Test design

GitHub Actions runs a temporary n8n **2.46.7** engine with the entire original eight-node workflow. To ensure no external spending is possible, an isolated fixture generator requires the source workflow to remain inactive and replaces only these execution endpoints:

- Draft Article POST: real OpenAI Chat Completions URL becomes `http://ci-n8n-mock:8080/v1/chat/completions`.
- Editorial Revision POST: same isolated fake.
- Return Secure Draft callback: app placeholder becomes `http://ci-n8n-mock:8080/api/agent/complete`.

The CI-only Webhook disables header authentication, because there is no real credential store in the disposable engine. The **source** Webhook retains headerAuth and its stable webhookId; the callback continues to use the per-job capability in `X-Agent-Key` and checks it against synthetic test input. The CI fixture cannot be exported to merchant deployments.

All three HTTP Request node destinations are statically verified against the fake server allowlist before import. The engine, fake provider and curl probe run in a `docker network --internal` bridge with **no external egress** or published ports. No model keys or Shopify secrets are injected.

## Scenarios

1. **Nominal flow:** n8n receives a valid test webhook, sends an exact shop/job-scoped HTTP 202 acknowledgment, then executes the writer and editor nodes. The mock verifies model identity, one-choice output cap, JSON response format and relevant prompts. The editor receives the writer output, and a final callback records exactly two stage-specific token reports and the original job-scoped callback capability. No merchant article is published.
2. **Adversarial editor:** Another test input generates an intentionally incomplete editor response (`finish_reason=length`). The webhook can already have returned 202, and the fake has received two billable-shaped model requests, but the Parse Reviewed Article guard must reject the output and **never call the app success endpoint**. This makes the need to keep uncertain spending reservations explicit.
3. **Bad capability:** A malformed callback token is rejected by the original Prepare Brief code, without reaching either model request or the callback.
4. **Source-structure checks:** Unit tests ensure no unexpected node or connection, secret, real model endpoint, attacker-specified callback URL or modified callback header can enter the test fixture.

**What this proves:** real n8n node expressions and response flows are compatible with the pinned engine, including an adverse partial-execution case. **What it does not prove:** provider billed amounts, retries under provider outages, real headerAuth behavior, verified Shopify session/OAuth, actual merchant outcomes, commercial n8n licensing or a complete subscription billing system.

## Execution

`bash scripts/ci-n8n-full-smoke.sh` on a Docker-capable authorized development host. The Windows development desktop presently does not have a Docker executable; GitHub-hosted CI provides an isolated engine.

This is a required additional quality gate before an explicitly approved **real** staging run. The source n8n workflows must remain inactive in source control.
