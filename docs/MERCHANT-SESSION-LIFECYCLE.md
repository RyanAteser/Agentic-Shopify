# Merchant session lifecycle and uninstall races (2026-10-27)

## Problem and merchant impact

An authenticated Blog Agent loader previously used StoreConfig.upsert on every
page load. A request that authenticated just before an uninstall could resume
after the uninstall webhook deleted merchant data and create StoreConfig again.
The settings-save action had the same risk. This violates the expected
post-uninstall erasure invariant and could enable accidental later background
work if another code path repopulated configuration.

## Locking contract

1. Blog Agent initialization and settings save require a matching persisted
   Session row for both session ID and shop. They update that row to its
   unchanged primary-key value inside a Prisma transaction to obtain a write
   lock on PostgreSQL, then read/create/update StoreConfig in that transaction.
2. app/uninstalled and shop/redact delete Session rows **first**, then
   StoreConfig, then all other merchant-owned records in one transaction.
   The same row lock serializes a delayed page request with redaction.
3. n8n callbacks, ranking imports, manager synchronization and credit/refund
   writes do **not** create StoreConfig. They acquire its existing row before
   writing merchant-owned data. A callback that commits before deletion is
   erased by redaction; one arriving afterward finds no config and is rejected.
4. Do not introduce a writer that creates StoreConfig without the persisted
   session lock. Do not reverse session/config order in redaction, or add a
   transaction that locks config then session: either change can reintroduce
   resurrection or deadlocks.

This does not rely on a successful Shopify API request after uninstall, and
does not retain an uninstall tombstone. A legitimate reinstall must establish
a new authenticated, persisted Shopify Session before initialization.

## Verification

- `tests/merchant-config.test.ts` checks fresh onboarding, session/shop
  isolation, stable scheduling preferences, and rejection of late GET/POST
  after deletion.
- The PostgreSQL-only case races two session-backed operations against
  redaction for five synthetic shops. Existing PostgreSQL callback/redaction
  tests cover non-session background writers.
- Run `npm run typecheck && npm test && npm run build` on SQLite and the
  PostgreSQL CI job. A development-store OAuth/install/uninstall test remains
  mandatory: it must verify actual session persistence and webhook delivery.

## Remaining boundaries

Shopify's `shop/redact` webhook is generally sent 48 hours after uninstall.
It should not be used as the sole immediate uninstall signal. Both verified
handlers call the same erasure helper. The Shopify SDK's behavior with expired
offline tokens and `authenticate.webhook` requires a separate real integration
test; a community report has described a token-refresh failure for uninstall
webhooks with expiring offline tokens. Do not assume this code-level race test
proves end-to-end compliance or that late Shopify articleCreate calls can be
cancelled.

Sources:
- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- https://shopify.dev/docs/api/webhooks/unstable
- https://www.postgresql.org/docs/current/explicit-locking.html
- https://community.shopify.dev/t/app-uninstalled-and-compliance-webhooks-return-500-after-enabling-expiring-offline-access-tokens/36449
