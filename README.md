# Agentic Shopify — AI Blog Agent

An embedded Shopify app backed by a secure n8n content workflow. **MVP in development; not deployed.**

Shopify stores remain authenticated in the app; n8n only gets a scoped content brief, returns structured article JSON, and cannot access Shopify tokens. Drafts require merchant review before publication. Feedback on rejected drafts is incorporated into future prompts. No real search performance learning is claimed until Search Console data is connected.

See [setup](docs/SETUP.md). Run with Node >=22.12 and Shopify CLI.

## New: AI Store Operating Team (roadmap)

- [Agent architecture, permissions, safety and rollout](docs/STORE_OS.md)
- [Connect the existing Bright Data ranking template](docs/SEO-AGENTS.md)
- [Pricing assumptions](docs/PRICING.md)
- `/app/team` team directory and `/app/seo` read-only product SEO audit / ranking history.

Only the Blog Agent is a substantive code prototype; other specialist agents are in development or planned. Neither Shopify OAuth nor n8n is connected in the repository, and there are no confirmed live autonomous store actions. Review n8n's commercial use conditions before exposing configurable automation to merchants.
