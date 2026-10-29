# AI article HTML size and publication safety

**2026-10-29. Development branch; no live Shopify content changed.**

## Problem and outcome

Merchant edits already enforced a conservative 60,000-byte HTML limit, but n8n callbacks used a separate 100,000-character input cap. A model-generated article containing multibyte text could therefore score as ready and reach the explicit Shopify publish mutation despite exceeding the merchant editor's safety budget. Older persisted drafts with high scores were also not checked at the final mutation boundary.

## Implemented controls

- A shared `MAX_ARTICLE_HTML_BYTES = 60_000` constant measures **sanitized UTF-8 HTML bytes**, not JavaScript string length or word count.
- Generated callbacks over this budget keep the complete sanitized draft, receive a score no greater than 40, and enter `needs_review`. The review warning directs the merchant to shorten and re-review. No content is silently cut, and the callback is not repeatedly retried as a transient network failure.
- Merchant corrections use the same budget, checked both before and after sanitization.
- The final Shopify publisher checks the current reviewed body within the merchant-locked transaction before its irreversible `articleCreate` call. Legacy oversized drafts are refused with a corrective message, retain `ready` status, and do not consume a publish attempt.
- This is a **conservative internal safety threshold**, not a claimed Google ranking factor or a verified universal Shopify API limit. Shopify still performs its own content validation.

## Evidence and limitations

Regression tests exercise 60,000/60,001 ASCII bytes, multibyte Unicode boundaries, generated callback persistence, and rejection of an already-reviewed legacy oversized draft before any Shopify GraphQL mutation. CI must pass SQLite, PostgreSQL and Docker jobs before treating this as verified.

A merchant can shorten a generated `needs_review` draft, then obtain a fresh human review and explicitly publish. This change does not establish the maximum body size supported by a particular Shopify theme, confirm rendered HTML fidelity, verify claims, or measure editorial time savings. Real Shopify development-store tests and consented merchant measurements remain required.

**Impact hypothesis:** fewer failed publication attempts and less manual reconciliation for long AI drafts. Measure the fraction of generated drafts above the budget, time to correction, and actual Shopify rejection rates in a consented pilot; do not report a conversion or SEO lift from synthetic tests.

Sources: [Shopify articleCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate), [Google people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).
