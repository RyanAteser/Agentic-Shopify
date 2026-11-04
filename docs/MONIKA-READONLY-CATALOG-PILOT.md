# Monika Blunder Beauty: read-only catalog integration

Status (November 3, 2026): **Shopify installation verified; backend NOT connected.**

## Verified installation (no catalog outcome yet)

- A separately created Partner custom-distribution app, **Agentic Commerce MBB Pilot**, was installed in the Monika Blunder Beauty Shopify admin.
- Its Dev Dashboard app ID is `443368472577`. Its first version requests only `read_products`.
- The installed-app list and developer install count (1) were checked. No article, product, price, customer, order, billing, or marketing changes were made.
- Shopify Admin **Settings > Domains** reports the canonical shop as `monikablunderbeauty-com.myshopify.com` (primary storefront domain: `monikablunderbeauty.com`).
- The app currently opens Shopify's default application-home page. It has **no connected application backend** and **no verified GraphQL product read**.
- This repository's broader Blog Agent still requests `write_content,read_products`. Never deploy that configuration to the read-only pilot.

## Implementation added on the feature branch

- `AGENTIC_PILOT_MODE=read_only` selects SDK `AppDistribution.SingleMerchant` instead of AppStore distribution.
- All authenticated merchant app access is limited to **GET /app/catalog**, plus Shopify's authentication flow under `/auth`.
- `AGENTIC_PILOT_SHOP` is checked against the **authenticated session shop**, never a browser query parameter, form field, or merchant-supplied URL.
- Pilot initialization rejects unexpected scopes or a missing canonical shop. A POST or other merchant dashboard path fails closed.
- The catalog-only page uses an existing bounded (at most 100 products) read-only Shopify GraphQL audit. It displays sample coverage and abstains on malformed API responses. It makes no merchant writes and does not persist catalog data.
- The rest of the full merchant application remains unchanged by default when pilot mode is not set.

## Deployment gate (not yet completed)

1. Provision an isolated stable HTTPS application host, isolated managed PostgreSQL, backups/retention, encryption and secrets. **No Agentic Shopify Vercel project was found in the connected account** at inspection time. Do not treat the old Artemis ngrok tunnel as a deployment target.
2. In the host secret manager, set `SHOPIFY_API_KEY` (for the new pilot), `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `DATABASE_URL`, `SCOPES=read_products`, `AGENTIC_PILOT_MODE=read_only`, `AGENTIC_PILOT_SHOP=monikablunderbeauty-com.myshopify.com`. Use independent secret values for this app and do not commit them.
3. The file `shopify.app.monika-pilot.example.toml` is an **inert template**, deliberately unlinked and pointing to `example.com`. Bind only the new pilot app in a trusted CLI environment; inspect `client_id`, URL, scopes, custom distribution and redirects before releasing any updated version.
4. The app's **initial installed version is non-embedded**, with Shopify's default app-home URL. For the React Router embedded SDK, publish a future version with `embedded=true`, an actual HTTPS URL ending in `/app/catalog`, and matching `/auth/callback` allowlist. Recheck the consent screen; never add `write_content` to this pilot.
5. Run committed PostgreSQL migrations and smoke `GET /health`. Verify the Shopify SDK stores tenant-scoped sessions encrypted/protected, online/offline token lifecycle, webhook HMAC and uninstall/shop-redact deletion. Do not activate n8n or marketing tasks.
6. Open the pilot as a merchant from the Shopify admin. Verify the rendered authenticated shop exactly matches `monikablunderbeauty-com.myshopify.com`, product query succeeds without write API calls, and errors/partial sample coverage are not represented as clean audits.
7. Negative tests: deny another shop session, `POST /app/catalog`, `GET /app/manager`, `POST /app`, credential absence, incorrect scope, expired/forged session, stale/uninstalled merchant, and Shopify API failure.
8. Confirm real webhook delivery, retention, GDPR obligations, n8n licensing decisions and commercial agreement separately. Keep automated publishing, payments and customer-data access disabled.

**Launch criterion:** authenticated catalog read + webhook/session tests on the newly configured HTTPS host, with wrong-tenant isolation demonstrated, before claiming the AI team is connected. A GitHub CI pass alone does not satisfy this.

Sources: Shopify documentation on custom distribution and SingleMerchant SDK authentication:
https://shopify.dev/docs/apps/launch/distribution
https://shopify.dev/docs/api/shopify-app-react-router/latest/entrypoints/shopifyapp
