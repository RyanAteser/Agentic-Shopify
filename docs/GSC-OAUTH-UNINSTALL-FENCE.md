# Search Console OAuth initiation and uninstall fence

**Status:** development branch only. No Google account, Shopify merchant, production deployment, workflow, or store was modified.

## Failure mode

The Google consent start route previously trusted an already-returned `authenticate.admin()` session and inserted a pending OAuth state without rechecking that its persisted Shopify Session still existed. An uninstall/redaction could delete all shop records while the request was in flight; the delayed route could then insert a new pending state after deletion. The callback finalizer only checked that state and could upsert an encrypted Google refresh credential without requiring an active StoreConfig. This was a **code-level race**, not an observed merchant incident.

A related lock-order problem existed: disconnect deleted the Google connection before pending states, whereas finalization consumed the pending state before writing the connection. Concurrent PostgreSQL operations could contend in opposite orders.

## Bounded changes

- `beginGoogleAuthorization(shop, sessionId, stateHash)` now checks the persisted, same-shop Shopify Session and creates the merchant configuration plus pending state **in one transaction**. It locks Session before StoreConfig, matching the redaction transaction. It also counts pending states under the merchant lock, limiting each shop to three simultaneous 10-minute attempts. A deleted/wrong-shop session creates no merchant data or OAuth state.
- `storeGoogleConnection` now locks the existing StoreConfig **before** consuming state and storing the encrypted token. A callback cannot recreate a connection for a merchant with no active StoreConfig, even if an orphaned state were injected.
- `disconnectGoogle` uses the consistent lock order StoreConfig → GoogleAuthState → SearchConsoleConnection → OrganicDailyMetric, deleting local consent and observations before best-effort external token revocation. No automatic reconnect or reimport is enabled.
- The OAuth route only redirects to Google after the transaction succeeds. Expired or invalid sessions receive HTTP 409; too many pending attempts preserve the existing rate-limit redirect.

The session and StoreConfig checks are **database lifecycle fences**, not a substitute for Shopify webhook HMAC validation, Google OAuth state/CSRF checks, or verified storefront property ownership. This change does not add scopes, merchant data access, model calls or external mutations.

## Verification

`tests/gsc-auth-initiation.test.ts` covers missing and cross-shop sessions, three-attempt limit, uninstall before initiation, synthetic orphaned state, successful finalization, replay rejection, disconnect cleanup and PostgreSQL initiation-versus-redaction concurrency. Existing `gsc-consent-race.test.ts` fixtures now explicitly establish active merchants and clean up their StoreConfig rows.

Run both SQLite and PostgreSQL CI. These are deterministic mocked/database tests, **not** a real Google OAuth callback, Shopify uninstall delivery or production deadlock proof. A staging trial must initiate consent, revoke app access mid-flight, trigger authenticated uninstall and shop/redact webhooks, and verify no new OAuth state, refresh credential or metrics remain afterward. Include delayed callbacks, concurrent disconnects, repeated authorizations and a clean re-install.

## Remaining limitation and merchant hypothesis

An **installed** shop may legitimately start fresh Google consent after a prior disconnect. A connect request already in flight when the merchant presses Disconnect may still initiate a fresh state after that disconnect if its persisted Shopify session remains valid. Closing that distinct intent-ordering race requires a durable consent-generation or revocation epoch, not only a session lock. Do not treat this change as a full revocation protocol.

Expected merchant benefit: reduced risk of post-uninstall data reattachment and fewer ambiguous consent states. No real privacy incidents, retention, trust lift, SEO clicks, revenue or cost savings have been measured. The launch gates for a live Shopify Partner install, Google OAuth verification, webhook delivery, infrastructure, n8n licensing and a consented merchant pilot remain open.

## Primary references

- [Shopify privacy-law compliance and mandatory shop redaction](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [Google OAuth 2.0 web server applications, state and CSRF](https://developers.google.com/identity/protocols/oauth2/web-server)

## Follow-up: explicit Disconnect intent boundary (October 30, 2026)

An installed merchant's explicit Disconnect now persists `StoreConfig.gscConsentRevokedAt` (new PostgreSQL migration and matching SQLite schema). The top-level Connect route captures its start timestamp **before** asynchronous Shopify authentication. `beginGoogleAuthorization` locks the same merchant configuration row as Disconnect and refuses to create a pending OAuth state when the request started at or before the latest revocation. It returns HTTP 409 and requires the merchant to initiate a fresh Connect action. Disconnect continues to delete pending states, credentials and measurements in one transaction.

This closes the demonstrated delayed-authentication race under a consistent application-clock assumption. It does **not** prove safety under arbitrarily skewed application workers: the boundary uses millisecond wall-clock timestamps. Before multi-region production deployment, verify NTP synchronization and clock skew under staging load or replace the timestamp fence with a strictly ordered, database-backed intent protocol. Do not interpret a new connection request as permission to bypass explicit merchant consent.

Regression coverage includes stale and fresh intent, pending-state deletion, replay refusal, cross-shop isolation and PostgreSQL concurrent Connect/Disconnect. No live Google account, Shopify store or merchant content is accessed. A staging integration must verify actual request/response ordering and revocation behavior before release.

A PostgreSQL concurrency test exposed an additional no-config race: Disconnect could run before the first Connect had created `StoreConfig`, leaving no revocation tombstone. Disconnect now locks an existing Shopify Session first (the same order as initiation and uninstall), creates a revocation-only StoreConfig if the session is still active, and refuses to recreate configuration after uninstall. The concurrent Connect/Disconnect test covers this previously failing case.

## Follow-up: shared database clock for consent ordering (October 30, 2026)

The earlier fence compared a Connect timestamp from the application worker with a Disconnect timestamp from a potentially different worker. A skewed worker clock could let a delayed Connect appear newer than an explicit revocation. Both boundaries now use the **primary database clock**: the Connect loader samples it before Shopify authentication, and Disconnect samples it inside its transaction after locking the merchant row. If the database clock cannot be read, Connect fails before creating an OAuth state. PostgreSQL uses `clock_timestamp()`, not transaction-start `now()`; SQLite development tests use `strftime('%Y-%m-%dT%H:%M:%fZ','now')`. The query contains no merchant input.

The regression test deliberately skews `Date.now()` by 24 hours and checks that the database time and stored revocation remain ordered and that a stale Connect is rejected. This avoids cross-worker clock disagreement without introducing a new permission or external API call. It does add one inexpensive database query per Connect attempt and one within each Disconnect transaction.

**Limits:** Database wall time can still jump due to clock adjustment; millisecond timestamp ties conservatively reject the Connect; the protocol assumes all workers use the same primary database clock, not independently clocked read replicas. A strictly monotonic database sequence is a stronger future option if multi-primary topology or strict total ordering becomes necessary. This is synthetic database verification, not a real Shopify or Google OAuth integration test. Confirm it on staging with two deliberately skewed app workers, delayed callbacks, uninstall, and a fresh legitimate Connect after revocation.

References: [PostgreSQL current-time functions](https://www.postgresql.org/docs/current/functions-datetime.html), [SQLite date/time functions](https://www.sqlite.org/lang_datefunc.html), [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server).
