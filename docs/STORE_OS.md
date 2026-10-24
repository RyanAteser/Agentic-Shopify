# Agentic Shopify — AI Store Operating Team
Status: **product direction / design spec**, not implemented store-wide automation. Existing code is a Blog Agent MVP, a read-only SEO validator, and draft n8n workflows. No store is connected or live.

## Product thesis
A merchant installs **one Shopify app** and receives a team of narrow, accountable AI specialists. The customer buys outcomes — fewer repetitive tasks, maintained catalog, better content, issue resolution and provable operational savings — not workflow executions.

**Manager Agent** routes evidence-backed recommendations into an approvals inbox; specialist agents work from explicit permissions and merchant goals. All workflow execution is server-side; no Shopify secrets go to models.

## Agent team and phased rollout
| Agent | Inputs | Proposes | Safe automated activity | Higher-risk action |
| --- | --- | --- | --- | --- |
| Store Manager | Work queues, approvals, budgets, metrics | Prioritizes tasks and resource budgets | Assign tasks, summarize results | Never elevate permissions |
| SEO Auditor | Shopify products, Google Search Console, keyword rank snapshots | Titles, descriptions, internal links, technical fixes | Read-only audit, alerts | Changing published SEO requires approval |
| Blog Editor | Merchant catalog and brand voice, editorial feedback | Human-readable articles and content clusters | Generate drafts | Publish requires explicit approval |
| Merchandiser | Catalog, availability, collections | Description and taxonomy improvements | Draft edits and reports | Bulk product/collection edits require approval |
| Performance Analyst | Shop reports, consented GSC/GA4 metrics | Funnel and retention insights | Read-only dashboards | Never claim attribution without evidence |
| Retention Marketer | Segments and consent from merchant's authorized ESP | Campaign and email drafts | Draft creation | Sends and audience changes need approval |
| Inventory Planner | Inventory quantities, sales velocity | Reorder and stockout recommendations | Alerts and forecasts | Purchasing, stock adjustments require approval |
| Customer Service | Consented customer tickets | FAQ and reply drafts | Internal triage | Refunds, order changes, customer-facing sends need approval |
| Competitor Researcher | Public store pages and lawful SERP data | Differentiation ideas, market changes | Read-only reports | No bypassing access controls / CAPTCHA |
| Amazon Marketplace | Authorized Amazon SP-API / Seller Central data | Listing drafts and audit | Read-only analysis | Listing edits/ad spending need approval |

## The one dashboard
1. **Today** — what the team found, prioritized by estimated impact and confidence.
2. **Your team** — capabilities, connected data, enabled/disabled status, estimated monthly spend.
3. **Approvals** — exact proposed diff, sources, rollback plan and one-time grant.
4. **Activity** — timeline of performed actions, model/tool provenance, failure states, hard spend caps.
5. **Results** — verified baseline vs post-change; distinguish observed correlation from causation.
6. **Settings** — brand rules, merchant goals, per-agent permissions, budgets, market / countries.

## Control plane
- Authenticated Shopify install -> tenant ID derived from trusted OAuth session, not model input.
- Shop-specific database isolation, event ledger, explicit job status and idempotency keys.
- A central planner reads typed observations, allocates bounded tasks and enforces policy **before** invocation.
- n8n workers execute approved **fixed** internal workflows; Shopify Admin API mutations only via the app backend.
- Model drafts are untrusted; review factual claims, avoid prompt-injection from products/web sources.
- Outputs and outcomes logged with inputs/source timestamps and merchant approval where needed.
- Automation levels: **Observe** (read-only), **Draft** (default), **Approve changes**, **Autonomous low-risk** (strict opt-in with audit/rollback).
- Never place orders, set prices, change inventory, refund transactions, send mass emails, update theme code, or spend ad budget autonomously during MVP.

### Inter-agent event contract (design, not implemented)
```json
{
  "eventId": "uuid",
  "shopId": "trusted-tenant-id",
  "agent": "seo_auditor",
  "kind": "recommendation.created",
  "object": { "type": "shopify_product", "id": "gid://shopify/Product/123" },
  "evidence": [{"source": "shopify_product", "retrievedAt": "2026-10-24T00:00:00Z"}],
  "proposedChange": {"field": "seo.description", "before": "...", "after": "..."},
  "risk": "approval_required",
  "idempotencyKey": "tenant:agent:object:version",
  "estimatedCostUsd": 0.02
}
```

## Bright Data keyword tracker integration
The user's screenshot shows: **Daily Schedule -> Input Keyword & Domain -> SERP Scraper Agent (Bright Data MCP) -> Parse SERP Results -> Google Sheets Log**. Keep this workflow intact and fork its parsed records into an authenticated ingestion endpoint in Agentic Shopify; preserve original rank, observed time, country/device, target URL and source. Don't pretend AI's ranking commentary equals SERP observation. Google Search Console data (verified property) is a different dataset (aggregated clicks/impressions/average position) and must be modeled separately.

## MVP release in four increments
1. Blog Agent + read-only Shopify SEO / rank observations + manager daily digest; no automated writes.
2. Catalog drafts and guarded review queue, merchant-controlled approval + change history.
3. Search Console / analytics connection and evidence-based optimization suggestions, controlled tests.
4. Retention/inventory/support opt-in agents; then Amazon SP-API optional add-on.

Avoid “everything at once”: earn trust with 2–3 excellent agents before enabling broad store-changing capabilities.

## Pricing hypothesis (not enabled)
- Free: 3 total AI article drafts and read-only sample SEO audit
- **Launch — $49/mo**: Blog + basic SEO + manager digest with monthly credit limit
- **Growth — $149/mo**: More credits, branded catalog and optimization agents, connected analytics
- **Operator — $399/mo**: Higher throughput, cross-agent coordination, approvals and priority support
- Optional Amazon module at additional price after authorized SP-API integration and pilot.
- Price on stores/agent capabilities plus transparent capped usage; don't promise unlimited tokens or infinite SERP scraping.
- **These are Store OS bundle hypotheses, not the previously proposed $19 standalone Blog Agent plan.** Test $19 blog-only alongside $49 bundle rather than silently replacing it.
- Shopify App Pricing in Partner Dashboard: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing

## Licensing — launch blocker
n8n's own current licensing FAQ distinguishes internal workflow-as-a-service from customers configuring workflow logic through your UI. Selling end-user workflow editing/configuration may require Enterprise/OEM, even when n8n's editor is hidden. An embedded n8n editor specifically requires OEM. Obtain written approval **before** selling a user-configurable automation platform. Keep code modular enough to replace the orchestrator if necessary.
- https://support.n8n.io/article/can-i-use-your-license-for-my-use-case
- https://n8n.io/oem/

## Non-negotiable security / launch gates
- Verify installed Shopify Partner app/client ID, scopes and Shopify webhook privacy handlers.
- Managed PostgreSQL and migrations, credential rotation, strong tenant isolation and tests.
- One-time approvals for outbound communication and store changes; keep full human-readable diffs.
- Merchant OAuth to marketing/analytics/marketplaces only upon opt-in; delete synced data on uninstall.
- n8n secrets kept in server secret manager, never in app client, chat prompts or committed workflows.
- Cost caps, rate limits, per-merchant queue quotas, retries with idempotency, and external provider error handling.
- Instrument costs and true performance baselines before product-market-fit claims.
