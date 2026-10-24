# Setup: Shopify Blog Agent + n8n

## Status
Starter implementation committed to the `feat/n8n-shopify-blog-agent` branch. Needs installation, database migration, credential binding and test-store validation. **No customer data or live article has been published by this work.**

## 1. Shopify app
- Use Node.js 22.12+ and Shopify CLI. Install dependencies with `npm install`, then run `npx prisma db push` for a local prototype (not production migration strategy).
- Create a Shopify dev store and link a new app via `npm run config:link` or the current Shopify CLI creation flow.
- Verify `shopify.app.toml` has `write_content,read_products`, API version 2026-10, and URLs matching your hosted app. Run `npm run dev` to install into the development store.
- Create or select an existing Shopify blog. Configure audience, brand voice, author and seed topics in the embedded app.

## 2. Credentials: never commit real values
On the **app server**, configure:
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES=write_content` (usually configured by Shopify CLI).
- `N8N_BLOG_WEBHOOK_URL`: the writer workflow's **production** webhook URL, once active.
- `N8N_OUTBOUND_KEY`: secret held by the app and the writer Webhook node's **Header Auth** credential with name `X-Agent-Key`.
- `N8N_CALLBACK_SECRET`: independent secret held by the app; add to the n8n outbound callback and scheduler **HTTP Header Auth** credentials as `X-Agent-Key`.

In **n8n**, import both `n8n/*.json` workflows and connect credentials:
- Writer > Receive Draft Request: Webhook Header Auth, header `X-Agent-Key` = app `N8N_OUTBOUND_KEY`.
- Draft Article and Editorial Revision: HTTP Request Header Auth: `Authorization: Bearer YOUR_OPENAI_API_KEY`. Keep key in n8n credentials.
- Return Secure Draft: HTTP Request Header Auth: `X-Agent-Key` = app `N8N_CALLBACK_SECRET`.
- Scheduled Dispatcher > Request Due Drafts: same callback-secret HTTP Header Auth credential.
- Replace the placeholder URL in Scheduled Dispatcher > Request Due Drafts with your real `https://YOUR_APP_HOST/api/agent/due`.
- Save and **publish** the n8n workflows to activate production webhook and hourly schedule. The app's webhook URL must use the production webhook path, not the ephemeral test URL.

## 3. Safe smoke test
1. Ensure the app was granted `read_products` so the agent can ground product links in actual published catalog URLs. No customer order data is required.
2. In your dev Shopify store, save the correct blog and merchant brief.
3. Leave `Automatically create drafts` unchecked; request one draft manually.
3. Inspect the n8n run: intake -> first-pass writer -> editorial rewrite -> callback. No Shopify credentials should appear in the execution.
4. Check the resulting draft and structural score in the app. Missing essentials should get `needs_review`.
5. Test reject with feedback, generate another draft, and confirm the next brief includes the rejection reason.
6. Verify explicit confirmation before Publish, then check the exact article and author in Shopify.
7. Enable scheduled drafts only after manual flow succeeds. Confirm a scheduler run creates **drafts**, never directly published posts.
8. Verify uninstallation cleans up saved app data.

## Architecture & boundaries
- Shopify OAuth/session storage stays in the app backend. n8n has neither Shopify API token nor publishing action.
- Each saved draft and job is scoped by the Shopify shop domain; callback checks the job/shop pair and requires a secret. Callback duplicates return the same draft rather than creating duplicates.
- The quality score is a simple structural checklist, **not** a factual verification, ranking predictor or Google score.
- Merchant-approved publishing calls the 2026-10 Shopify Admin GraphQL `articleCreate` mutation. On uncertain outcomes, status changes to `needs_reconciliation`; inspect the Shopify admin before retrying.
- Store-specific feedback is reused in subsequent prompts. There is **no fabricated traffic data** or SEO lift promise.
- For production: use PostgreSQL and migrations, encrypted at-rest data, per-tenant permissions and limits, queue backpressure, failure retries, consent / privacy compliance, credential rotation, observability, and verified end-to-end tests.
- Search Console and attributed conversion analytics will be a separate opt-in connector. Assess performance with 28-day impressions, clicks, qualified visits and revenue outcomes relative to seasonality; do not optimize on a model's own score.

## Product backlog
1. Merchant product catalog context (read_products scope only if the merchant enables this feature).
2. Search Console + Analytics ingestion, with verified shop ownership and metric provenance.
3. Content clusters, duplicate-topic prevention, internal linking to verified merchant URLs.
4. A/B topic selection, contextual bandit with exploration budget and guardrails.
5. Publish scheduling, brand approvals and true opt-in autopublishing after reliability testing.
6. Multi-store worker queue, concurrency limits, operational dashboard and billing.

Sources:
- Shopify app scaffold: https://shopify.dev/docs/apps/build/scaffold-app
- Shopify ArticleCreate: https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate
- n8n Webhook: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook
- Google people-first guidance: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
