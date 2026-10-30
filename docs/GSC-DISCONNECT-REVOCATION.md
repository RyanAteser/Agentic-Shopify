# Google Search Console disconnect: current-token revocation

**Status:** Development-branch safeguard, not a live Google OAuth or Shopify uninstall test (2026-10-30).

## Failure mode

Previously, `disconnectGoogle` read the encrypted Google refresh token **before**
acquiring the merchant's database lock. A concurrent, already-authorized
re-consent could replace that token while Disconnect waited for the lock.
Disconnect would delete the **new** credential locally but send the **old**
credential to Google's revocation endpoint. The new token would remain
unrevoked at Google despite a successful local disconnect.

## Protocol

1. Lock the merchant configuration using the established Session → StoreConfig
   order and advance the monotonic consent revocation sequence.
2. Read the current encrypted Google credential **inside the same transaction**
   after acquiring the merchant lock.
3. Delete pending OAuth states, the connection and shop-scoped GSC observations
   in that transaction, preserving the existing consent/uninstall fence.
4. After commit, best-effort POST that exact credential to Google's revocation
   endpoint. Do not retain the credential in the database or log it.
5. Treat non-2xx HTTP responses as **unconfirmed** revocation, not success.
   A generic warning is emitted without upstream bodies, tokens or merchant URLs.

This does not make remote Google revocation atomic with database deletion.
Network failures can leave a remotely valid but locally forgotten token. A
durable privacy-preserving retry strategy would require an explicit retention
and encryption design, legal review and tenant-scoped lifecycle guarantees;
do not silently retain deleted tokens or retry after uninstall.

## Verification

- PostgreSQL regression holds a StoreConfig row lock while rotating a token,
  then starts Disconnect. It asserts the **latest committed** token, not the
  pre-lock snapshot, is sent to the mocked Google endpoint.
- SQLite/PostgreSQL regression injects HTTP 503 and asserts local deletion
  plus a sanitized warning without credential or response-body leakage.
- No live Google calls, Shopify writes, n8n activations or billing operations.

## Production gate

Repeat with two staging app workers, real Google OAuth and delayed callbacks;
verify revocation status and re-consent behavior under network failure and
Shopify uninstall. Follow Google's OAuth revocation guidance:
https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
and Shopify's privacy requirements:
https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

**Merchant outcome hypothesis:** fewer residual remotely valid tokens after
disconnect and clearer incident handling. No real incident rate, retention or
revenue change has been measured.
