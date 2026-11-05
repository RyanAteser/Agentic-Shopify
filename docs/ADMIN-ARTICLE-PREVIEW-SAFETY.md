# Merchant admin article preview safety (development branch)

**Status: code-level safeguard only.** No Shopify store, n8n workflow, production deployment or merchant content was changed.

## Why this matters

The app sanitizes new AI callbacks and merchant edits, and its publication gate rejects legacy HTML that no longer meets the current policy. However, two authenticated merchant pages previously rendered the raw stored `ArticleDraft.body` through React `dangerouslySetInnerHTML`. Older, imported or manually corrupted rows can bypass today's input sanitizer. Publication validation cannot protect an earlier admin preview from injected markup or browser navigation.

OWASP specifically identifies untrusted React `dangerouslySetInnerHTML` as an XSS sink. Shopify's app security guidance calls for server-side allowlist sanitization of HTML and URL schemes.

## Change

- The Blog Agent review and publish-confirmation previews and Store Manager inbox preview now receive **server-sanitized, display-only** HTML from `safeArticlePreviewHtml`. Both use the same allowlist and URL policy as new article content.
- An unsafe or noncanonical stored body displays a warning. The preview is not represented as the exact approved payload, and the stored body and review digest are **never modified by rendering**.
- Malformed or over-100,000-character legacy content gets **no HTML preview**. Merchants can still inspect the original text in the Blog Agent editor. Publication continues to fail closed under the independent safety check.
- Valid article formatting and supported sponsored/ugc/nofollow links remain visible. This does **not** verify product claims, destination ownership, affiliate disclosure or storefront rendering.
- Regression tests cover script/event-handler injection, dangerous URL normalization, ordinary merchant links, oversized fallback and both route sinks.

## Limitations and release gate

This is a defensive preview sanitizer, not a full browser penetration test. Test the two authenticated views in an authorized Shopify development store with harmless injection fixtures and browser CSP/network monitoring. Verify that unsafe markup cannot execute or navigate, that warnings are understandable, and that normal links and formatting are preserved. Do not import or publish malicious fixtures to an active store. Keep n8n inactive until licensing, privacy, billing and real integration gates are satisfied.

**Impact hypothesis:** fewer admin-session injection opportunities and greater merchant confidence in editorial review. There are no observed incidents prevented, adoption gains, conversion improvements or revenue results.

Sources: [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet); [Shopify app security](https://shopify.dev/docs/apps/build/security); [Shopify: don't serve user-written code to storefronts](https://shopify.dev/docs/apps/build/security/storefront/dont-serve-user-written-code).
