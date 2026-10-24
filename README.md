# Agentic Shopify — AI Blog Agent

An embedded Shopify app backed by a secure n8n content workflow. **MVP in development; not deployed.**

Shopify stores remain authenticated in the app; n8n only gets a scoped content brief, returns structured article JSON, and cannot access Shopify tokens. Drafts require merchant review before publication. Feedback on rejected drafts is incorporated into future prompts. No real search performance learning is claimed until Search Console data is connected.

See [setup](docs/SETUP.md). Run with Node >=22.12 and Shopify CLI.
