# Article link safety and merchant verification

**2026-10-29. Development branch only; no merchant content or live stores modified.**

## Problem

The AI writer is instructed not to invent product URLs, but prompts do not prove that a generated link is genuine. Previously the article sanitizer allowed plain HTTP links and did not distinguish malformed, credential-bearing, local-network or otherwise suspicious destinations in the merchant's editorial warnings. A syntactically valid link can still be inaccurate, deceptive, paid, affiliate or irrelevant.

## Implemented safety boundary

`evaluateArticle` now applies the same link policy to AI callbacks and merchant-edited drafts:

- Retain absolute **HTTPS** links only when they have a normal domain hostname, no embedded URL credentials, no non-default port, no IP-literal destination and no local-only host suffix. This is a syntactic safeguard, **not** proof that the destination is safe or accurate.
- Retain single-slash relative links (for example `/products/boots`) only when WHATWG URL resolution against a fixed dummy storefront origin stays on that origin. Reject scheme-relative `//host/path`, backslash-obfuscated, ASCII control-character and malformed destinations. Browser URL parsers remove tabs and newlines: a deceptive `/\\n/attacker.example` link can resolve to an external host despite its raw single-slash prefix. The sanitizer removes that click target without fetching URLs.
- Remove unsafe `href` attributes while retaining readable anchor text. The existing HTML sanitizer still strips scripts, event handlers and unsupported tags.
- Add actionable review notes for the number of removed links, distinct HTTPS hostnames (up to five shown), and relative links. Never log complete URLs or query parameters, which may contain private tokens.
- Preserve the existing structural score and manual editorial review/publish authorization. Link counts are **not** a ranking signal and do not earn quality points.
- Preserve merchant-supplied `rel="sponsored"`, `rel="nofollow"` and `rel="ugc"` on retained HTTPS or storefront-relative links. Normalize comma/space-separated values, deduplicate tokens and remove unsupported values with a review warning. Strip `rel` when a destination is rejected. Do **not** infer a sponsored relationship, invent disclosures or automatically add a qualification.
- Merchant editors can enter an HTML anchor such as `<a href="https://partner.example/item" rel="sponsored">Partner product</a>`. The sanitizer preserves this attribute in the draft body sent for publication, but actual storefront rendering must be verified in staging.

The same validation applies when a merchant saves draft corrections. An editor should recheck link text after unsafe destinations are stripped. Existing drafts are not retroactively changed by this commit; they must be reviewed before publication.

## Limits and staging gates

1. This does **not** prove the URL belongs to a verified Shopify product, that a source supports a claim, or that a website is benign. A valid HTTPS domain can still be malicious or an irrelevant competitor.
2. HTTPS redirect targets, DNS, ownership, page availability, affiliate status and commercial relationships are not fetched or verified. Do not perform arbitrary network fetches from model-provided URLs without an SSRF-safe, consented design.
3. Merchant-authored links to private hosts or plain HTTP pages will lose their click target. This conservative behavior requires real merchant UX validation and a clear warning before rollout.
4. Google says paid and affiliate outbound links should be appropriately qualified (`rel="sponsored"` or `nofollow` as applicable). The app preserves supported merchant-authored link qualifications but does **not** infer sponsorship, decide which links need qualification, or generate advertising disclosures. Merchants must check and add appropriate disclosures; incorrect or missing qualifiers remain possible.
5. Verify Shopify rich-text rendering, link accessibility, review-note visibility and editing behavior in an authorized development store. Test false removals and actual merchant review time. No merchant trust, revenue, SEO, retention or conversion benefit has been measured.

## Measurement

In a consented pilot, record aggregate counts of stripped destinations, merchant-confirmed false removals, verified corrections, review minutes and rejected drafts. Do not store link query strings or claim that a warning prevented harm without independent validation. Stop or revise the policy if false removals disrupt legitimate merchant links.

Sources: [Google link qualification guidance](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links), [Google Search spam policies](https://developers.google.com/search/docs/essentials/spam-policies), [Google link qualification guidance](https://developers.google.com/search/blog/2021/07/link-tagging-and-link-spam-update), [Shopify GraphQL articleCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/articlecreate).
