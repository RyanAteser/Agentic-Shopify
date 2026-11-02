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

The script checks database readiness, the Shopify-managed login redirect, and the distinction between **browser authentication bootstrap** and **bot rejection**. On this SDK, a Node-like bot user-agent receives HTTP 410 `Gone` before authentication. Therefore a 410 response **does not prove** that a protected dashboard route verified an ID token. With a normal Chrome user-agent and no ID token, the SDK returns a minimal HTTP 200 document containing the App Bridge session bootstrap; the test asserts that no merchant dashboard HTML is rendered and that the Shopify Admin framing policy is present. This bootstrap response is not a successful logged-in UI.

The script does **not** install the app, exchange a token, request paid AI generation, or write merchant content.

### Verified embedded UI, Nov 2, 2026

An existing **signed-in** Chrome window for `artemisti.myshopify.com` was inspected and its Artemis tab refreshed. The Blog Agent page rendered in the Shopify Admin iframe with sidebar navigation, the connected merchant, 0 drafts awaiting review, 3 remaining lifetime free generations, and draft scheduling off. Its settings form rendered correctly. The Store Manager sidebar destination loaded with its queue, decision audit trail and merchant context. This visual browser check supersedes earlier uncertainty based only on unauthenticated redirects and health probes.

The Store Manager explicitly warned that the catalog sample was unavailable, so product-specific recommendations were not verified. Do not fill that gap with invented product evidence. Further gates: authenticated read-only Shopify Admin API round-trip, all workspace routes, separate staging infrastructure and production credentials.

A blank iframe or incorrect UI after future changes should be debugged with the browser Console and Network tabs, App Bridge bootstrap, Content Security Policy, SDK logs and a real signed-in session. A healthy `/health`, a bot-only 410, and even a successful TypeScript build are insufficient on their own.
## Guardrails

- Do not run `shopify app deploy` with the development configuration; production needs a stable hosted HTTPS URL and PostgreSQL.
- Do not enable automated n8n workflows, merchant publication, or paid model invocations during setup.
- No merchant tokens belong in Git, CLI arguments, or test logs.
- Quick Tunnel URLs and ports change between sessions. The preview works only while the CLI, backend, and tunnel remain online.
- The `write_content` scope is present for future merchant-approved drafts but is **not** permission to publish without explicit review.
