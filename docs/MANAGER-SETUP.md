# Store Manager: Implementation, setup, and safety

## Current status
Implemented on the `feat/n8n-shopify-blog-agent` branch; **not deployed or Shopify Partner app authorized**. The local build and unit/integration tests run on `D:\Agentic-Shopify` (Windows).

## Merchant UI
Open **`/app/manager`** from the embedded Shopify app. The server authenticates the shop from a Shopify OAuth session; no tenant ID is accepted from the browser.

The manager aggregates:
- **Blog Agent** drafts in `ready` or `needs_review` state. Ready drafts with structural score >=70 appear for full preview, claims verification and one-time "Approve & Publish". Lower-scored drafts link to blog editing. The sync inspects the 30 newest eligible drafts for new recommendations; older pending recommendations are only retired after checking the exact draft's current status, never merely because they fell outside this sample.
- **SEO Agent** actionable metadata findings for the first 50 active products (read-only). A merchant can accept, dismiss or mark manual follow-up complete; accepting is NOT a live Shopify mutation.
- **Bright Data SERP Agent** observed organic ranking drops of >=3 places across comparable keyword+engine+country+device observations. Does not conflate ranks with Search Console average position or SEO-derived revenue.
- **Activity log** recording approval and dismissal decisions. Each source recommendation is unique within its shop and does not reopen silently on refresh.

All imported text and URLs are untrusted evidence. No model-provided prompt can set authorizations or cause writes.

## Automation
Import the **inactive** `n8n/shopify-store-manager.json` workflow into the existing n8n instance. Create an outbound **HTTP Header Auth** credential with:
- Name: `X-Agent-Key`
- Value: app-side secret `N8N_CALLBACK_SECRET`, stored in n8n Credentials.
- Replace the placeholder URL with `https://<YOUR-PUBLISHED-APP>/api/manager/sync`.

After live deployment and Shopify app installation, activate n8n workflow. Once an hour it invokes the backend, which processes at most 10 stores that have not been synchronized in 24 hours, oldest first. Refresh is read-only and does not automatically publish.

The worker endpoint returns only aggregate counts. No raw merchant content or tokens are returned to n8n. Never expose Shopify access tokens to n8n.

## Safe publishing
1. Merchant expands the draft and checks facts, links and brand.
2. Merchant explicitly checks "I verified" and confirms publish.
3. Server requires an authenticated Shopify session and valid `pending` approval associated with that shop.
4. Conditional DB claim of `ready` article prevents double submission.
5. Shopify GraphQL `articleCreate` is attempted once. On unknown outcome, draft becomes `needs_reconciliation` and must be manually inspected; never blind-retry.
6. Same publishing helper is shared with the original Blog Agent UI.

Source: https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate

## Limitations before launch
- Local SQLite for development only. Migrate to managed Postgres with transactional retry-safe job queues for production.
- Ranking integration requires the merchant's **actual exported n8n workflow JSON** to map exact node output fields, and the Bright Data account's authorized credential.
- Shopify Partner app/client ID, development store OAuth, approved scopes, n8n instance, hosted app URL and AI credentials are not connected.
- No Shopify product edits, refunds, inventory changes, mass email sends or ad budget changes are performed by this manager.
- This is prioritization logic, NOT revenue optimization proof. Run controlled evaluations with GSC, analytics and cost data before claiming improvement.
- Operational controls still needed: per-tenant rate limit and spend caps, connectivity monitoring, privacy review and full end-to-end production-hosting tests.
- n8n commercial/OEM rights must be resolved before selling merchant-configurable workflow building.
