# Monika Blunder Beauty: read-only catalog integration

Status (November 3, 2026): **Shopify installation verified; backend NOT connected.**

## Verified installation (no catalog outcome yet)

- A separately created Partner custom-distribution app, **Agentic Commerce MBB Pilot**, was installed in the Monika Blunder Beauty Shopify admin.
- Its Dev Dashboard app ID is `443368472577`. Its first version requests only `read_products`.
- The installed-app list and developer install count (1) were checked. No article, product, price, customer, order, billing, or marketing changes were made.
- Shopify Admin **Settings > Domains** reports the canonical shop as `monikablunderbeauty-com.myshopify.com` (primary storefront domain: `monikablunderbeauty.com`).
- The app currently opens Shopify's default application-home page. It has **no connected application backend** and **no app-specific OAuth/GraphQL product read**.
- Separately, the user-authorized Shopify connector switched to the correct Monika Blunder Beauty Shopify Plus store and successfully fetched a small live read-only product/SEO sample. **That connector has different authentication and is not evidence the installed pilot app has exchanged OAuth credentials.**
- This repository's broader Blog Agent still requests `write_content,read_products`. Never deploy that configuration to the read-only pilot.

## Implementation added on the feature branch

- `AGENTIC_PILOT_MODE=read_only` selects SDK `AppDistribution.SingleMerchant` instead of AppStore distribution. Pilot-specific environment markers (`AGENTIC_PILOT_SHOP`, `AGENTIC_PILOT_CLIENT_ID`, or even an empty `AGENTIC_PILOT_MODE`) without exactly `AGENTIC_PILOT_MODE=read_only` now fail closed (HTTP 503), rather than silently selecting the full application. This check runs during Shopify SDK initialization and on guarded requests/services.
- All authenticated merchant app access is limited to **GET /app/catalog**, plus Shopify's authentication flow under `/auth`. Initial `/` opens redirect to the catalog route.
- Background n8n callbacks, scheduled dispatch, manager/ranking imports and Google OAuth completion routes explicitly deny pilot mode before their service effects. Authenticated lifecycle/privacy webhooks remain enabled but verify tenant identity after Shopify HMAC authentication.
- `AGENTIC_PILOT_SHOP` is checked against the **authenticated session shop**, never a browser query parameter, form field, or merchant-supplied URL.
- `AGENTIC_PILOT_CLIENT_ID` is a separate required app identifier and must match the runtime `SHOPIFY_API_KEY`. This detects inconsistent configuration, **not independently whether both values belong to the correct app**. Before deployment compare both with the client ID displayed for the newly installed pilot in Shopify Dev Dashboard; do not inherit Artemis credentials.
- Pilot initialization rejects unexpected configured scopes or a missing canonical shop. After Shopify authentication, the actual granted `session.scope` must also be exactly `read_products`; additional scopes are denied rather than trusted. A POST or other merchant dashboard path fails closed.
- The catalog-only page uses an existing bounded (at most 100 products) read-only Shopify GraphQL audit. It displays sample coverage and abstains on malformed API responses. It makes no merchant writes and does not persist catalog data.
- Pilot catalog findings are now additionally scoped to the **primary storefront host attested by the authenticated Shopify Admin API**. Cross-domain product links, URL userinfo, non-HTTPS, alternate ports, query/fragment variants and invalid hosts are excluded. The UI reports the partial sample rather than presenting excluded pages as audited. This is a tenant/SEO accuracy safeguard, not proof of rankings or growth.
- The rest of the full merchant application remains unchanged by default when pilot mode is not set.

## Railway Free provisioning record (November 3, 2026)

- Private project: `agentic-shopify-mbb-pilot` (`5216fb0d-e7ba-4273-8ae7-8f98cadbd1dc`), with its **own** PostgreSQL service and persisted volume. The Postgres service can enter **Sleeping** state on Railway Free; a service creation is not an application deployment.
- The **still-offline** `mbb-catalog-api` empty Railway service was created with `AGENTIC_PILOT_MODE=read_only`, canonical `AGENTIC_PILOT_SHOP`, `SCOPES=read_products`, and a private `${{Postgres.DATABASE_URL}}` reference. Seven settings/variables including the app's public client ID and the client secret were applied in Railway's own masked environment-variable store, **not** in GitHub. A subsequent `SHOPIFY_APP_URL` setting for the assigned domain is staged, not yet applied. Shopify OAuth is **not verified**.
- Railway UI Settings (not GitHub config): Dockerfile builder, `/health` readiness path, 180-second timeout, and `npx prisma migrate deploy --schema prisma/schema.postgresql.prisma` pre-deploy command were applied. There is **no application source**, so the service is offline. The auto-assigned public domain is `https://mbb-catalog-api-production.up.railway.app`, but **no HTTP healthcheck or OAuth response was verified**. Never point Shopify's currently installed app at this URL until the service is running successfully.
- Railway's UI states that **Config as Code is deprecated**: newly created services cannot opt into legacy config files after August 28, 2026. The earlier `railway.monika-pilot.json` and its test were removed because they could not control this new service. Configure Build = Dockerfile, Healthcheck, and Pre-deploy directly in Railway UI or an officially supported Infrastructure-as-Code method.
- Railway cannot access private `RyanAteser/Agentic-Shopify` without its GitHub App installation, which asks for write access to code, actions, workflows and repository administration. **Do not accept All repositories or grant these permissions without explicit informed owner approval.** An authenticated local clone exists at `D:\\AgenticShopify-MBB-Pilot`. Railway documents a temporary **project-scoped** token and local `railway up --project 5216fb0d-e7ba-4273-8ae7-8f98cadbd1dc --environment production --service mbb-catalog-api` as an alternative, but the connected desktop tool blocked creating that token automatically. No token was minted for this project. A human may run the scoped CLI deploy, then revoke the project token, without giving Railway GitHub administration rights.
- The Free plan's `$1` monthly credit does not guarantee continuous app + PostgreSQL operation. Check usage and avoid upgrades or overages.

## Audit evidence gate (November 3, 2026)

- A verified primary-host URL is a prerequisite for counting a product as audited. If the Shopify sample contains zero eligible URLs (including password-protected stores), the catalog UI explicitly states **no SEO audit was performed** rather than displaying a reassuring `No issues detected` message.
- A partial primary-host sample or paginated catalog is labeled as a partial observation. A clean bounded sample cannot establish indexing, full-store SEO quality, ranking changes or revenue lift.
- Regression tests cover zero-product and zero-eligible-product samples, partial and full bounded samples, findings present, and invalid coverage denominators.
- This is an offline accuracy improvement only. No hosted OAuth connection, merchant write, Search Console import, ranking or sales outcome was verified.


- Duplicate verified canonical product URLs across distinct Shopify product records now cause the pilot catalog audit to abstain rather than double-count page coverage or findings. This is a data-integrity check, not evidence of merchant SEO performance.

## CI HTTP route smoke for the read-only pilot

The Docker CI job now starts a second ephemeral application process with **inert synthetic Shopify identifiers** and `SCOPES=read_products`. It checks database-backed `GET /health`, rejects unauthenticated access to privileged UI paths (`/app`, `/app/manager`, `/app/seo`) and the background dispatch endpoint (`POST /api/agent/due`), and requires `GET /app/catalog` without a Shopify session to redirect for authentication or return a non-successful authorization response (the current SDK returns HTTP 410 for absent Shopify launch context). Tests run against the compiled production image with a throwaway PostgreSQL service.

These checks do **not** use merchant API tokens, call the Shopify Admin API, prove a live OAuth handshake, prove legitimate authorized catalog reads, or verify webhook HMAC delivery. CI tests must remain separated from the real installed pilot. See `scripts/ci-container-smoke.sh`.

### Product-page URL evidence gate

A verified primary storefront host alone does not establish that an Online Store URL is a product detail page. The catalog pilot now accepts only canonical HTTPS `/products/{handle}` URLs (including optional `/en/` or `/en-US/` Shopify locale prefixes). Primary-host homepage, collections, blogs, unexpected nested routes, and percent-encoded handles are excluded from product-specific SEO findings; the resulting reduced sample is explicitly labeled partial. This intentionally abstains on unsupported custom product URL rewrites rather than inventing page-level SEO evidence. A real storefront must be checked for custom routing before expanding eligibility.

### Readiness gate added before hosted OAuth

The HTTP `GET /health` endpoint must return `503` if the read-only pilot's declared scope, client ID, canonical shop or mode fails `assertPilotConfiguration()`, even if PostgreSQL responds. The same production-image Docker smoke now checks a valid synthetic `read_products` pilot is ready and a deliberately misconfigured `read_products,write_content` pilot is **not** ready. This does not independently prove Shopify-issued grants, Shopify Partner installation or live OAuth; it protects the load-balancer from accidentally admitting a misconfigured deployment.

## Deployment gate (not yet completed)

1. Provision an isolated stable HTTPS application host, isolated managed PostgreSQL, backups/retention, encryption and secrets. **No Agentic Shopify Vercel project was found in the connected account** at inspection time. The connected Supabase organization is on the Free tier with two unrelated active projects; reusing those databases would violate the pilot isolation gate. The previously used EC2 SSH endpoints were unreachable from the authorized desktop. Do not treat the old Artemis ngrok tunnel as a deployment target. Do not create a chargeable database/project without explicit cost approval.
2. In the host secret manager, set `SHOPIFY_API_KEY` (for the new pilot), `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `DATABASE_URL`, `SCOPES=read_products`, `AGENTIC_PILOT_MODE=read_only`, `AGENTIC_PILOT_CLIENT_ID` (new pilot app's public client ID), `AGENTIC_PILOT_SHOP=monikablunderbeauty-com.myshopify.com`. Use independent secret values for this app and do not commit them.
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
