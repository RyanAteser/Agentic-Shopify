# Monika Blunder Beauty: read-only catalog integration

Status (November 5, 2026): **Hosted read-only backend healthy; Shopify Partner pilot v2 active; merchant confirmed rendered authenticated catalog: 28 products sampled, 28 eligible URLs, 0 heuristic review observations. Webhook delivery and Google indexing remain unverified.**

## Independent five-product live storefront parity (November 5, 2026)

**Method:** A separate, authorized **read-only Shopify Admin connector** query for `status:active published_status:published` returned 28 products, `hasNextPage=false`, with 28 primary-storefront product URLs. Every product carried a custom SEO title and description; no duplicate effective SEO titles or Shopify metadata-only problems were found under the pilot's current rules. Select deterministic catalog indices 0, 8, 10, 23 and 26 for a cross-section of a tool, flagship foundation, mascara, lip bundle and starter bundle. This connector's credentials **are not** evidence of the installed pilot app's token, though the merchant separately confirmed the embedded view returned the same 28-product count.

**Cross-layer replay:** Extend the existing `scripts/public-storefront-seo-audit.py`, not a second crawler. Supply exactly five URLs and their expected SEO fields from a separate, local, ignored Admin-metadata manifest via `--expected-json`. Validate exact primary-domain product URLs and reject cross-host/unsafe/duplicate entries *before network access*. Respect robots.txt, bound response size/time and request count, and make only public GET requests. Never persist HTML or expose Shopify access tokens. Local Python tests now include title/description parity, deliberate mismatch, unsafe-manifest and redirect negative controls.

Observed in the five selected **live public pages**:

| Product | HTTP | Canonical | Robots meta | Admin vs rendered title/description | JSON-LD |
| --- | --- | --- | --- | --- | --- |
| Cosmetic Clutch | 200 | Exact self URL | `index,follow` | Both match after whitespace/HTML entity normalization | Valid Product+Offer **and one additional malformed Product JSON-LD script** |
| Blunder Cover | 200 | Exact self URL | `index,follow` | Both match | Valid Product+Offer |
| Architect Eyes Buildable Mascara | 200 | Exact self URL | `index,follow` | Both match | Valid Product+Offer |
| Lip Trio Pink | 200 | Exact self URL | `index,follow` | Both match | Valid Product+Offer |
| Blunder Cover Starter Bundle | 200 | Exact self URL | `index,follow` | Both match | Valid Product+Offer |

All five stayed on the same HTTPS product URL and had one H1. The HTTP responses did not include an `X-Robots-Tag: noindex`; the public `robots.txt` had a Googlebot `Allow: /` rule. These are **technical crawlability signals, not Google Search Console indexing status**.

**One confirmed markup defect needing merchant review:** The Cosmetic Clutch page has a *second* `<script type="application/ld+json">` claiming `"@type": "Product"`, whose unescaped raw line breaks inside the `description` JSON string cause Python's strict JSON parser to reject it (invalid control character, line 7). The *other* Product script on the page is valid and includes offer data. Therefore the malformed block is a real HTML/JSON syntax issue, **not evidence that Google has lost Product markup, rich results or rankings**. Do not automatically edit the live Shopify theme. The merchant can ask the theme owner to serialize dynamic description text with a JSON-safe serializer, test in a theme preview, and validate using Google's [Rich Results Test](https://search.google.com/test/rich-results) before explicitly authorizing publication.

**Heuristics separated from facts:** The existing public sampler also issued five `long_title_heuristic` flags, mainly because the theme adds `– Monika Blunder Beauty`, and one `long_meta_description_heuristic` for the mascara's 257-character description. These six are **not Google penalties or proven SEO issues**. The standalone report now distinguishes `observed_markup_conditions={"malformed_jsonld_script":1}` from `review_heuristics={"long_title_heuristic":5,"long_meta_description_heuristic":1}`. It reports `admin_parity_checked=5`, zero title/description mismatches, five valid Product+Offer blocks, and zero fetch errors. This is **1 observed malformed block among five pages**, not a measured 20% store-wide issue rate.

**Falsification and next gate:** Re-run the same five-page manifest after a preview-only structured-data fix to verify the malformed-script flag disappears without affecting canonical, title, meta description or Product+Offer coverage. Separately inspect Google Search Console's URL Inspection / Product snippets reports to determine actual Google-recognized markup and indexing. No new merchant permissions, content changes, active-theme edits, SEO rankings, revenue or conversion outcomes are claimed.

## Merchant-observed rendered catalog (November 5, 2026)

The merchant supplied the exact on-screen result from the installed embedded read-only app following the authenticated browser launch:

- **Authenticated Shopify merchant:** `monikablunderbeauty-com.myshopify.com`.
- **Sampled products:** 28.
- **Eligible product URLs:** 28 of 28.
- **Review observations:** 0.
- **Display conclusion:** "No issues detected among eligible sampled products. This is not proof of Google indexing, full-store SEO quality or growth."

**Evidence level:** Merchant-observed rendered UI text, consistent with the earlier Railway `GET /app/catalog 200` after hosted OAuth. This closes the specific *rendered non-error catalog page* verification gate. It is not a replayable independent audit of Shopify GraphQL response bodies and is not evidence of Google indexing, search rankings, organic traffic, conversion, sales uplift, or absence of SEO problems outside the bounded sample. A zero-observation result indicates that the current heuristic checks did not flag the 28 eligible sample URLs; it does not establish SEO health. No merchant data was changed.

**Remaining release gates:** validate at least one signed webhook delivery and uninstall behavior with no mutation; reconcile reported 28 products against a frozen read-only Admin API sample in a reproducible, privacy-safe test; add lightweight outcome telemetry and evaluate whether the merchant finds the audit useful. Keep PR draft and broad content-generation / billing / n8n capabilities disabled.

## Shopify Partner app release and OAuth observation (November 5, 2026)

- On the authorized Windows desktop, Shopify CLI 5.0.1 linked the **correct** custom-distribution app, `Agentic Commerce MBB Pilot` (`gid://shopify/App/443368472577`). Its public client ID matched the isolated Railway deployment's `SHOPIFY_API_KEY` and `AGENTIC_PILOT_CLIENT_ID`; Railway also confirmed `SCOPES=read_products`, `AGENTIC_PILOT_MODE=read_only`, and the exact canonical pilot shop. These checks did not print secrets.
- With explicit owner approval, the linked app configuration was changed **only** to `embedded=true`, `application_url=https://mbb-catalog-api-production.up.railway.app/app/catalog`, and `auth.redirect_urls=[https://mbb-catalog-api-production.up.railway.app/auth/callback]`. The existing `read_products` scope and five webhook subscriptions were retained. The Shopify CLI validator returned `valid: true`, `issues: []`.
- `shopify app deploy --config monika-pilot --allow-updates --no-input --json` succeeded, reporting `released: true` for [app version `agentic-commerce-mbb-pilot-2`](https://dev.shopify.com/dashboard/148974351/apps/443368472577/versions/1197011861505). A separate Shopify CLI versions listing confirmed v2 is **active** and v1 inactive. A fresh fetch from Developer Dashboard confirmed the intended URL, embedded flag, callback, scopes and webhook subscriptions. The local linked `shopify.app.monika-pilot.toml` is **untracked**, and no credentials or app client secrets were committed to GitHub.
- The hosted Railway service reports a successful deployment and `GET /health` returned 200 with `{"status":"ready"}`. The operator launched `/auth/login?shop=monikablunderbeauty-com.myshopify.com` in the desktop browser. A direct unauthenticated request to that login endpoint returned HTTP 302 to Shopify Admin's `/oauth/install` route; **after** the browser launch, Railway logged a server-side `GET /app/catalog 200` and no `Read-only catalog pilot unavailable` warning was found in the last 150 deployment log lines. Direct requests to `/app/catalog` without Shopify launch context still returned 410.
- In this release, `/app/catalog` calls `authenticate.admin(request)` and validates the session shop and actual session scope **before** the catalog audit. The hosted 200 is therefore evidence of successful session authorization on that request. **It is not yet independent proof that the user saw valid catalog SEO findings or that the authenticated Shopify GraphQL query returned the expected product sample**: a handled catalog read failure may also return HTTP 200 with an unavailable message. Verify the actual rendered UI or a narrowly instrumented, privacy-safe sample success event in a follow-up.
- **Unverified:** production HMAC webhook deliveries, uninstall/revocation behavior, rendered audit coverage, long-running deployment cost and availability, and any change to organic search traffic, conversion or merchant revenue. No product, price, order, customer, content, billing, marketing, n8n or scope expansion actions were performed. Keep the broader application draft branches separate from this live, isolated, read-only pilot.

## Railway source-archive reproducibility (November 5, 2026)

A remote Railway CLI `up` to the existing isolated `mbb-catalog-api` service failed at Docker `npm ci` because the CLI upload honored `.gitignore`, which listed `package-lock.json` even though that lockfile is committed and ordinary GitHub Actions/Docker builds include it. No application instance was started by the failed build. The PR now stops ignoring the tracked lockfile and includes a CI check using `git check-ignore --no-index` to catch future exclusions before another Railway upload. Keep `.env`, merchant credentials and local workfiles excluded; **do not** use `railway up --no-gitignore` on the working directory to bypass this error.

This build-packaging repair does not validate Shopify OAuth, installed app permissions or SEO outcomes.

## Original installation record (November 3, 2026)

- A separately created Partner custom-distribution app, **Agentic Commerce MBB Pilot**, was installed in the Monika Blunder Beauty Shopify admin.
- Its Dev Dashboard app ID is `443368472577`. Its first version requests only `read_products`.
- The installed-app list and developer install count (1) were checked. No article, product, price, customer, order, billing, or marketing changes were made.
- Shopify Admin **Settings > Domains** reports the canonical shop as `monikablunderbeauty-com.myshopify.com` (primary storefront domain: `monikablunderbeauty.com`).
- At the original installation, the app opened Shopify's default application-home page and had no connected backend. This historical state was superseded by the November 5 v2 configuration release and hosted OAuth observation documented above.
- Separately, the user-authorized Shopify connector switched to the correct Monika Blunder Beauty Shopify Plus store and successfully fetched a small live read-only product/SEO sample. **That connector has different authentication and is not evidence the installed pilot app has exchanged OAuth credentials.**
- This repository's broader Blog Agent still requests `write_content,read_products`. Never deploy that configuration to the read-only pilot.

## Pagination metadata integrity (November 4, 2026)

The bounded product reader now requires a nonempty Shopify connection to supply a nonempty `pageInfo.endCursor` even when `hasNextPage=false`, and requires an empty completed connection to have a null end cursor. This rejects contradictory GraphQL mappings instead of allowing a final page with missing cursor evidence to be reported as a complete SEO sample. Regression tests cover nonempty final pages with missing/empty cursors, empty final pages with stale cursors, and a legitimate empty catalog. This does not attest Shopify OAuth or prove catalog completeness outside the requested search filter.

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

## Compiled-image write-denial regression (November 4, 2026)

The production-image smoke now requires HTTP 403 for POST requests to `/app/catalog`, `/app`, `/api/seo/rankings`, and `/api/agent/due` in synthetic read-only pilot mode. This verifies the actual HTTP route boundary, not only pure guard functions. It prevents a permitted catalog GET from accidentally implying permission for a catalog POST or background connector import. These tests use inert credentials and no merchant data; they do not verify real Shopify OAuth, session grants, or webhook delivery.

## CI HTTP route smoke for the read-only pilot

The Docker CI job now starts a second ephemeral application process with **inert synthetic Shopify identifiers** and `SCOPES=read_products`. It checks database-backed `GET /health`, rejects unauthenticated access to privileged UI paths (`/app`, `/app/manager`, `/app/seo`) and the background dispatch endpoint (`POST /api/agent/due`), and requires `GET /app/catalog` without a Shopify session to redirect for authentication or return a non-successful authorization response (the current SDK returns HTTP 410 for absent Shopify launch context). Tests run against the compiled production image with a throwaway PostgreSQL service.

These checks do **not** use merchant API tokens, call the Shopify Admin API, prove a live OAuth handshake, prove legitimate authorized catalog reads, or verify webhook HMAC delivery. CI tests must remain separated from the real installed pilot. See `scripts/ci-container-smoke.sh`.

### Product-page URL evidence gate

A verified primary storefront host alone does not establish that an Online Store URL is a product detail page. The catalog pilot now accepts only canonical HTTPS `/products/{handle}` URLs (including optional `/en/` or `/en-US/` Shopify locale prefixes). Primary-host homepage, collections, blogs, unexpected nested routes, doubled or trailing slashes, and percent-encoded handles are excluded from product-specific SEO findings; the resulting reduced sample is explicitly labeled partial. This intentionally abstains on unsupported custom product URL rewrites rather than inventing page-level SEO evidence. A real storefront must be checked for custom routing before expanding eligibility.

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

### Bounded finding disclosure

The read-only catalog pilot displays at most 25 individual SEO observations to avoid an unbounded merchant page. It preserves the full observation count and explicitly reports how many observations are omitted when the count exceeds 25. This prevents a merchant from mistaking the visible subset for a complete issue list. Observations are heuristic and unverified against live Google indexing or merchant conversion data; no content is published or changed. Future pilots should test whether this disclosure improves merchant interpretation and follow-up completion rather than assuming a revenue lift.

### Bounded review priority and measurement

The first 25 findings are now sorted by existing severity (`high` before `medium`) and then stable finding ID. This prevents the first 25 products returned by Shopify from hiding high-severity observations later in the bounded sample. The total and omitted counts remain visible; when more than 25 high-severity observations exist, even high-severity findings may be omitted. Severity is a review priority, **not** a measured conversion, traffic or revenue impact. No claim of complete issue coverage, Google indexing, ranking lift or a live merchant outcome is warranted. A consented pilot should track the fraction of reviewed high-priority findings and merchant-confirmed usefulness, rather than number of generated recommendations.

### Empty continuation page fail-closed gate (2026-11-04)

If Shopify reports `hasNextPage: true` for a product page but the following page contains zero products, the bounded pilot now rejects the scan instead of declaring the earlier subset a complete catalog. This guards the merchant against a misleading zero-issue conclusion during inconsistent cursor pagination. A genuinely empty first page with `hasNextPage: false` remains valid. Regression cases cover empty final and empty nonfinal continuations. This is a defensive response-consistency check, not evidence that Shopify routinely produces such responses or that merchant SEO improves.

### OAuth configuration readiness gate (2026-11-04)

The read-only pilot's `/health` preflight now additionally requires a configured Shopify client secret (minimum 16 characters, without leading/trailing whitespace) and a public HTTPS application origin without URL credentials, a path, query, fragment, or non-standard port. An otherwise healthy database no longer makes a pilot with a missing secret or unusable callback origin appear ready. The check never prints the secret. Regression tests cover absent/short secrets, HTTP/local origins, credentials, unexpected paths/ports and valid HTTPS origins.

**This is static configuration validation only.** A plausible value does not verify that the secret matches the installed Shopify app, that DNS resolves, that Railway is running, or that Shopify OAuth/session exchange succeeds. Compare the client ID to the Dev Dashboard and execute a merchant-consented hosted OAuth smoke before opening access. Do not apply the staged Railway URL or deploy the app automatically.

### Canonical URL regression and CI gate (2026-11-04)

CI run [#41804773693](https://github.com/RyanAteser/Agentic-Shopify/actions/runs/41804773693) failed in all three jobs because the strict product-path regex had escaped slash delimiters twice, producing TypeScript parse errors at `app/lib/pilot-catalog-scope.ts:36`. Commit `6c80d47` repairs the literal. The existing test matrix covers localized canonical product paths and malformed paths; a passing fresh CI run is required before considering the branch deployable. This fix changes no live merchant data and does not validate hosted OAuth.

### Product identity integrity gate (2026-11-04)

The bounded catalog parser now requires the canonical Shopify `gid://shopify/Product/<positive decimal ID>` identity for every product record. Wrong resource types (such as Collection and ProductVariant), malformed IDs and decorated IDs fail the entire read instead of appearing as product-level SEO findings. This guards against accidental GraphQL selection/mapping regressions; it does not prove indexing, product publication, or storefront rendering. Synthetic regression tests cover valid large IDs and rejected cross-resource IDs. Hosted Shopify read-only OAuth remains unverified.

### Explicit catalog URL exclusion counts (2026-11-04)

The read-only audit now distinguishes product URLs excluded for a different host from those excluded for a noncanonical same-host product route (for example a collection redirect, trailing slash or tracking query). These are **sample coverage** counts, not Google indexing or SEO ranking measurements. Invalid/non-HTTPS URLs are already counted by the initial Shopify sample validator and are not double-counted in the canonical subset. The displayed total remains limited to the bounded sample. No merchant data is persisted or changed.

### Compiled HTTP write-denial semantics (2026-11-04)

The container smoke test distinguishes two safe rejection paths: POST to the loader-only `/app` and `/app/catalog` routes is rejected by React Router with **405 Method Not Allowed** before their loaders run, while POST to guarded action routes (`/api/seo/rankings`, `/api/agent/due`) must return **403 Forbidden**. A 405 is not evidence that the pilot guard executed; it establishes only that the framework did not dispatch the unsupported method. The synthetic container smoke does not establish authenticated tenant isolation or live Shopify OAuth behavior. CI failure [#41883244112](https://github.com/RyanAteser/Agentic-Shopify/actions/runs/41883244112) exposed the incorrect prior expectation of 403 for the loader-only route.

CI run [#41892514294](https://github.com/RyanAteser/Agentic-Shopify/actions/runs/41892514294) established that `/app` also returns 405 to POST because it has no action. Commit `01df8dd` aligns the smoke assertion with the observed compiled-router response. The test still requires 403 on write-capable API endpoints; a passing fresh container job is required to verify them.
