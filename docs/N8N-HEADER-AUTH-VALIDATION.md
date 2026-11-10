# Credential-backed full n8n staging safety gate

**State:** CI-only, draft and inactive in production. This is a credential-authentication test, not a real AI-provider cost or Shopify OAuth test.

The earlier complete eight-node n8n 2.46.7 workflow fixture tested expression chaining, writer/editor mocked token reports, error rejection and the app callback, but it deliberately disabled inbound Webhook Header Auth. That left a security-critical gap: n8n could accept anonymous HTTP jobs in test even though production requires a credential.

## What the new gate tests

The new `n8n-auth` GitHub Actions job uses the same complete eight-node workflow with every outbound HTTP destination pointed at the disposable fake model and callback service. However, its inbound Webhook retains `authentication: headerAuth` and gains an n8n credential **reference**, not any inline secret.

GitHub CI generates a random temporary key and a temporary `httpHeaderAuth` credential specifying `X-Agent-Key`. The real n8n CLI imports it into the ephemeral instance's encrypted credentials table. The source workflow's `headerAuth`, its stable `webhookId`, and all job-scoped callback logic remain unchanged. The temporary plaintext credential import file is deleted after import. No real merchant or provider credentials ever enter CI.

The real HTTP tests require:

1. Missing `X-Agent-Key` gets **403** before any writer/editor/callback stage.
2. Incorrect `X-Agent-Key` gets **403**, with no model requests.
3. Correct n8n credential returns **HTTP 202** echoing the exact job and shop, then the mock writer and editor each receive one bounded model request, followed by a correctly scoped mock app callback carrying two worker-reported token records.
4. A deliberately incomplete editor output returns no false success callback, even when both mock model calls have run.
5. A malformed per-job capability remains rejected before external work despite a valid inbound Header Auth credential.

Docker has `--internal` networking with no published host ports; the CI fake server is the only reachable HTTP destination for the full workflow. The production source workflow remains inactive. This test does not publish, install, or bill anything on a merchant store.

## How to run

On an authorized Docker-capable development system:

```sh
CI_N8N_WEBHOOK_HEADER_AUTH=true bash scripts/ci-n8n-full-smoke.sh
```

The existing mock-only workflow test remains available with no additional env flag. The explicit flag only enables ephemeral real n8n Header Auth testing; it cannot enable any paid provider.

## Why this is not a revenue or pricing validation

n8n credential storage and webhook auth correctness are necessary, but actual vendor charges, model pricing, licensing, Shopify subscriptions and merchant results still require their own evidence. These CI jobs use dummy requests and zero paid model calls.

**Before enabling real merchant dispatch:** verify a real authorized staging store installation, commercial n8n terms, provider-side project limits, actual writer/editor token usage vs invoice charges, and reimbursement/uncertain-call handling. Record a time-bounded approved spend cap in an operator change log. Never repurpose the CI fixture in production.

References: https://docs.n8n.io/integrations/builtin/credentials/webhook and https://docs.n8n.io/hosting/cli-commands/
