# Artemis: isolated Shopify development preview

This checkout is a **development-only** integration of Agentic Shopify with the existing Artemis app. Use the explicit store `artemisti.myshopify.com` and do not deploy these temporary settings to other stores.

## Why the CLI previously showed a blank preview

Shopify CLI requires a `shopify.web.toml` to discover and start a React Router web process at the project root. Without it, `app dev` could show a ready proxy without running the app backend. The web configuration now launches `npx react-router dev --host 0.0.0.0`, with both frontend and backend roles.

The named `shopify.app.development.toml` links to **Artemis**, enables tunnel URL updates for the selected development store, uses the 2026-10 webhook API, and registers the expected app/privacy routes. The repository's default `shopify.app.toml` was deliberately left unchanged to prevent an accidental production configuration push.

## Start from the isolated integration checkout

Run in PowerShell:

```powershell
cd D:\AgenticShopify-Artemis-Integration
npm install
npx prisma generate
npx prisma db push
npx shopify app dev --config development --store artemisti.myshopify.com
```

Shopify CLI injects local development API credentials and starts an HTTPS Cloudflare Quick Tunnel. Leave the CLI running during browser testing. Do **not** use `--no-update`, which would retain the placeholder URL. The named config contains `https://example.com` only as a non-operational placeholder; `app dev` replaces it for the selected development store.

For a noninteractive command runner, append `--no-input --skip-dependencies-installation`. Do not run `app config link` against the default config: linking can replace the local TOML with an unrelated, older remote app configuration.

### Local database

`prisma/schema.prisma` is the SQLite development schema. Use `prisma db push` only against a newly initialized local dev DB. The committed migrations are for `prisma/schema.postgresql.prisma`; applying them to SQLite via `prisma migrate deploy` fails with P3019. PostgreSQL integration tests require an isolated PostgreSQL service and correctly configured `DATABASE_URL`. Do not point this development session at a real production database.

## Read-only verification

Copy the **actual temporary tunnel URL** printed by `shopify app dev`:

```powershell
node scripts/smoke-artemis-dev.mjs https://YOUR-TUNNEL.trycloudflare.com
```

This checks that `/health` reports an available database, that `/auth/login?shop=artemisti.myshopify.com` redirects to Shopify's installation endpoint, and that five protected dashboard routes (`/app`, `/app/team`, `/app/manager`, `/app/seo`, `/app/growth`) reject requests without a verified Shopify ID token. Shopify's current embedded authentication may return HTTP 410 for these tokenless requests. The smoke test accepts an explicit authentication rejection or managed redirect, not a 200 or a server error. It does **not** install the app, exchange a token, make billable AI requests, or write merchant content.

Open the generated Shopify Admin preview URL **in a browser signed into the Artemis development store**. Complete Shopify's managed installation/login flow, then verify that `/app`, `/app/team`, and `/app/manager` render as authenticated pages. The embedded App Bridge navigation should show Blog Agent, Store Manager, AI Team, SEO Intelligence and Verified Growth. The Blog Agent home should show a store-specific overview with unapproved ready drafts, remaining free generations, and draft-scheduling state. Verify session persistence in the isolated database. This is the manual end-to-end auth gate; a 302 redirect alone is not proof of OAuth completion. A successful build and navigation-source test do not prove that Shopify Admin's iframe renders for a signed-in merchant. If the iframe is blank, inspect the browser Console and Network tab for the first failing script, Content Security Policy violation, or authenticated loader request before treating it as fixed.

## Guardrails

- Do not run `shopify app deploy` with the development configuration; production needs a stable hosted HTTPS URL and PostgreSQL.
- Do not enable automated n8n workflows, merchant publication, or paid model invocations during setup.
- No merchant tokens belong in Git, CLI arguments, or test logs.
- Quick Tunnel URLs and ports change between sessions. The preview works only while the CLI, backend, and tunnel remain online.
- The `write_content` scope is present for future merchant-approved drafts but is **not** permission to publish without explicit review.
