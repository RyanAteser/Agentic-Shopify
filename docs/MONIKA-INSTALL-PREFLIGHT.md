# Monika Blunder Beauty: Shopify installation gate

**Updated status (2026-11-03): The separate Partner custom app `Agentic Commerce MBB Pilot` is installed with `read_products` only; the backend and OAuth catalog request are NOT verified.** This runbook originally described the broader, uninstalled `write_content,read_products` application from draft PR #1. For the actual installation and narrower pilot, see [MONIKA-READONLY-CATALOG-PILOT.md](MONIKA-READONLY-CATALOG-PILOT.md). Do not use the broader app configuration for this pilot.

## First: identify the app and ownership

1. In the Shopify Dev Dashboard, open the intended app and record **app name, organization, client ID suffix only, and app type**. Never paste a client secret into tickets.
2. If the app belongs to a Partner organization, locate its distribution/install controls and confirm its supported distribution model. If it belongs to a merchant organization, look for **Installs** and confirm whether that app can be installed on the target shop. Do not assume a store-created custom app can be reused across unrelated shops.
3. Confirm the target `*.myshopify.com` domain directly in the merchant's Shopify Admin. A marketing domain or display name is not a substitute for the canonical shop domain.
4. Verify the merchant account authorizes installation and that the requested scopes are acceptable. The repository currently requests `write_content,read_products`; `write_content` permits content changes even if our own UI requires approval. Do not request customers, orders, billing or additional scopes.

## Repository-side preflight (no live changes)

- This branch's `shopify.app.toml` currently has **blank `client_id`** and no bound app URL. It is **not install-ready** as committed.
- Link the intended Partner-owned app using `npm run config:link` from a trusted operator environment; inspect the resulting config diff and verify app identity before accepting it.
- Provision isolated HTTPS app host, PostgreSQL, secrets and callback URLs first. `npm run dev` may provide a temporary dev tunnel, but is not a stable production merchant installation.
- Validate OAuth redirect allowlist, embedded app navigation, Shopify session storage, app uninstall and mandatory privacy webhook endpoints. Record exact environment and version; do not commit credentials.
- Check n8n licensing and integration status separately. Shopify installation does **not** activate AI workflows or justify publishing.

## Permission and go/no-go

Before requesting installation, show the merchant the app identity, canonical shop domain, permission list, data handling/retention plan, support and uninstall procedure. Obtain explicit merchant approval. Install only through Shopify's authenticated admin authorization flow, never by sharing an Admin API token.

After authorized installation: verify app opens in Shopify Admin, OAuth state/session handling, read-only product query scoped to this shop, correct empty-state behavior, and no access to a second shop. Do not create articles or activate n8n until a separate test plan and approval. Revoke/uninstall on any unexpected scope or wrong-shop association.

## Evidence to capture

Record app ID suffix, organization type, target shop domain (in private operator notes), app URL and redirect host (not secrets), scopes shown on consent screen, installation timestamp, OAuth success/failure, webhook delivery status, and screenshots with customer data redacted. A green CI build is **not** proof of live OAuth.

## Blocking decisions

- **Wrong app/organization:** create or link an appropriately distributed Partner app rather than copying an existing merchant app's secrets.
- **No Distribution menu:** inspect app organization and **Installs** rather than guessing an installation URL.
- **No deployed HTTPS app/DB:** stop before installing a merchant production store.
- **Missing merchant consent:** stop. Use an isolated development store first.

References: https://shopify.dev/docs/apps/launch/distribution and https://shopify.dev/docs/apps/build/authentication-authorization .
