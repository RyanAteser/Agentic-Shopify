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

## Store Manager · Unified Inbox

- `/app/manager`: shop-scoped, prioritized tasks from Blog Agent, SEO catalog checks and observed Bright Data keyword drops, with explicit merchant review, dismissals, historical decisions and guarded blog publishing.
- `n8n/shopify-store-manager.json`: optional hourly schedule asking the app to refresh up to 10 shops' **read-only** recommendations. Inactive until imported and secured.
- `app/routes/api.manager.sync.ts`: secret-authenticated server task coordinator, zero Shopify mutation privileges; requires active merchant installations.
- An SEO recommendation accepted by the merchant is **not** automatically applied to Shopify. Publishing blog posts still requires merchant verification and consent.
- Setup: [Store Manager](docs/MANAGER-SETUP.md) and [Store OS](docs/STORE_OS.md).

## Verified Growth (new)

- `/app/growth` merchant dashboard: actual Google Search Console 28-day comparisons, only when verified OAuth connection has enough daily observations; no modeled or fabricated SEO gains.
- `/app/growth/connect` read-only Google consent, property/Shopify-primary-domain verification, encrypted OAuth refresh token.
- `/api/growth/sync` and `n8n/shopify-growth-gsc-sync.json`: optional scheduled, bounded Search Console importer. No Shopify write permissions.
- `prisma/schema.postgresql.prisma` + committed PostgreSQL migrations for hosted production database; local SQLite stays in `prisma/schema.prisma`.
- [Release gates and deployment](docs/PRODUCTION-READINESS.md)

**Important:** This branch is not yet deployed. Real merchants must authorize Shopify and Google; current local test output must not be represented as actual traffic or sales growth.
