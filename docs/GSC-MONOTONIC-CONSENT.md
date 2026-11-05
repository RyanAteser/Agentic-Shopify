# Google consent intent ordering: monotonic database fence

**Development-only change (2026-10-30).** No Google account, merchant, Shopify store, n8n workflow, billing or deployment was modified.

## Problem and merchant consequence

The previous Connect/Disconnect fence compared timestamps sampled from the primary database. That removed disagreement between application-worker clocks, but the database wall clock can still be adjusted and two requests can share a millisecond. A slow Connect initiated before an explicit Disconnect must never re-create a pending Google authorization after revocation. A stale callback must also be unable to reconnect a deleted token.

## Protocol

1. The top-level Connect route commits an atomic increment of the singleton `GscConsentOrderCounter` **before** awaiting Shopify authentication. This allocates a strictly increasing `bigint` intent order, with no shop name or credential in the counter.
2. Once Shopify authenticates, `beginGoogleAuthorization` locks the persisted same-shop Session and StoreConfig, then refuses the pending state if `requestOrder <= gscConsentRevokedOrder`. Pending state limits and ten-minute expiry remain unchanged.
3. Disconnect locks Session then StoreConfig, increments the **same counter inside its transaction**, persists `gscConsentRevokedOrder`, and deletes pending states, credentials and metrics. The counter lock is acquired only after the shop lock, so the transaction does not hold it during Google or Shopify network requests.
4. The existing callback consumes a state only under the active merchant lock. A revoked or deleted state cannot finalize. Explicit new Connect intents after Disconnect obtain a higher order and remain allowed.

This replaces **timestamp-based authorization decisions**, but retains `gscConsentRevokedAt` as an audit timestamp. Counter increments use Prisma's atomic number operation; PostgreSQL migration seeds the singleton, while an atomic upsert initializes SQLite `prisma db push` databases. No OAuth tokens, shop identifiers or consumer data are stored in the counter.

## Tests and rollout requirements

`tests/gsc-auth-initiation.test.ts` covers delayed Connect, Disconnect before initial StoreConfig, same-shop session validation, replay rejection, uninstall, cross-tenant isolation, application clock jumps, and PostgreSQL concurrent increments. SQLite and PostgreSQL CI must both pass, including migration deploy, TypeScript, build and Docker smoke. These tests are **synthetic**, not real Google OAuth or Shopify uninstall integration.

**Rollout must not mix old timestamp-fence workers with new monotonic-fence workers.** Drain old workers, apply the migration, then start only new workers. Mixed-version Disconnect may not increment the counter, invalidating the intended ordering. Before production, verify on two staging workers with delayed Shopify auth, concurrent Disconnect, Google callback, uninstall webhook and clean reinstall. Test database failover/rollback as well: restoring an older counter or StoreConfig snapshot independently would violate the monotonic ordering contract. The singleton is a low-volume write hotspot; monitor contention rather than assuming infinite scale.

## Outcome hypothesis and remaining gates

Expected impact is lower risk of consent reattachment after revocation and clearer merchant trust boundaries. **No privacy incident, adoption, retention, organic traffic or revenue improvement has been measured.** Shopify Partner dev-store integration, Google OAuth verification, staging credentials, n8n commercial licensing and merchant validation remain blockers. This work does not authorize store changes, publishing, billing, sending messages or deployment.

## Primary documentation

- [Prisma atomic number operations](https://www.prisma.io/docs/orm/v6/reference/prisma-client-reference#atomic-number-operations)
- [Google OAuth 2.0 web-server flow and state validation](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Shopify privacy compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
