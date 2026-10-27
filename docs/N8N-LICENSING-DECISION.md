# n8n commercial licensing decision — release blocker

**Reviewed: 2026-10-26. Status: UNRESOLVED; do not commercialize merchant-configurable n8n workflows without written clearance.**

Official n8n FAQ (updated October 6, 2026):
https://support.n8n.io/article/can-i-use-your-license-for-my-use-case

## What the official FAQ actually says

- Under the self-hosted Community Sustainable Use License, our team can create and edit fixed workflows, run them for clients on our own instance, charge for the service, and let clients connect accounts **provided clients cannot open the editor or change workflow logic**.
- If outside users can **build or configure** workflows through n8n, our own interface, the API, MCP, or an AI agent, a commercial/Enterprise license is required. White-labeling n8n or offering n8n itself as a service also requires a commercial license.
- The FAQ says support cannot determine whether a particular use case is allowed. For written permission/licensing questions: **license@n8n.io**; for commercial licensing: **sales@n8n.io**.

## Our current product is not automatically cleared

The existing four inactive JSON workflows are centrally authored. However, merchants can set blog topics, cadence, brand voice, audience and enable draft scheduling in the Shopify UI. **Do not assume these settings are permitted just because merchants cannot see n8n nodes.** They may constitute configuration of an n8n-powered automation, and n8n explicitly includes configuration through our own UI in the commercial-license trigger.

No external customer may edit n8n nodes, credentials, workflow expressions, execution settings, webhooks, or workflow logic in the current app. Do not add a merchant-facing workflow builder, natural-language workflow editing, custom automations, or n8n API passthrough without license review.

## Release decision paths

| Path | What ships | Required decision |
|---|---|---|
| Fixed managed workflows | Our team owns and edits the workflows; merchants only receive outputs and submit editorial briefs | Ask n8n in writing whether the existing merchant settings and schedule controls qualify under SUL; retain written clearance |
| Merchant-configurable automation team | Merchants can customize triggers, schedules, agents or execution logic in our UI | Obtain suitable n8n Enterprise/commercial terms **before** enabling |
| Independent orchestrator | Reimplement execution using code and services we are licensed to redistribute | Engineering, security, cost and maintenance review; no implied n8n rights |

**Do not use an unverified interpretation as a launch or pricing assumption.**

## Questions to send to n8n licensing

1. Can a multi-tenant Shopify SaaS charge merchants for outputs from centrally managed fixed workflows, with no editor/API access?
2. Are merchant-supplied topics, brand voice, approval decisions, and a draft-generation button considered workflow configuration?
3. Does a merchant-controlled recurring cadence or enable/disable switch require Enterprise licensing?
4. Would an AI agent that changes prompts, nodes, branching or schedule based on merchant feedback constitute workflow configuration?
5. What agreement and commercial pricing apply to this exact product model, and what restrictions govern storing third-party merchant credentials?

## Engineering constraints until answered

- Keep all n8n workflow exports inactive; do not deploy or enable them for paying merchants.
- Keep workflow authoring and credentials under our operators only; never expose the n8n editor/API to merchants.
- Keep Shopify publishing behind explicit authenticated merchant approval.
- Record any written licensing determination and reassess the unit economics before billing activation.

This is a product-release gate and a licensing risk assessment, **not legal advice or proof of permission**.
