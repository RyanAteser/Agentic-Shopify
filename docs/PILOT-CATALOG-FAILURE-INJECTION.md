# Catalog read failure-injection regression

The catalog route now calls `runObservedCatalogRead`, which receives three stage operations and a privacy-safe event sink. Its unit suite injects failures at primary-domain verification, catalog-page reading, and audit computation. Each failure must produce one classified warning without exception payloads; an empty successful catalog must emit one success.

This is **not** a live Shopify API test or an alert-delivery test. The route still authenticates before the observed pipeline, so SDK authentication errors and redirects are not counted as catalog failures. Existing merchant warnings remain unchanged; no HTTP status behavior changes. The runner intentionally suppresses exception details and does not log shop identity or product data.

Release gates: passing TypeScript/tests/build and production-container CI; hosted authorized failure injection with monitored event delivery; separate OAuth/session, wrong-tenant, and uninstall verification. Do not merge or deploy on unit evidence alone. No merchant outcome is established.
