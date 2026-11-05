# Merchant corrections to AI-generated drafts (development only)

**Status:** Implemented on draft PR #1; not installed in any active merchant store. Saving a correction changes only the application's own unpublished draft. It does **not** call Shopify article mutations, n8n, a paid model, or billing.

## Why this exists

The initial review queue allowed a merchant to mark a draft usable or reject it, but not to correct a minor error. That made each fix a new generation or rejection, rather than an ordinary editorial step. Shopify's own blog post editor supports merchant edits; its HTML editor also warns that copied HTML can break storefront presentation. We provide a constrained HTML text editor before the app's separate explicit publish action.

- A merchant can edit **title, excerpt, body HTML, tags and primary keyword** while status is `ready` or `needs_review`.
- The app applies the same server-side HTML sanitizer and structure heuristic used for generated content. Only permitted markup and safe HTTP(S) links survive. The score is **not** a Google ranking predictor or a factual accuracy check.
- The app rejects empty/oversized inputs instead of silently truncating them. The body is capped at **60,000 UTF-8 bytes** as a conservative margin under Shopify's documented 64 KB rich-text content limit. A Shopify development-store test is still required to establish real API/theme behavior.
- Saving edits recalculates the structure score and sets `ready` or `needs_review`. It does not silently turn a weak draft into approved content.
- A SHA-256 optimistic edit fingerprint over all five editable fields rejects stale browser forms, preventing one editor from overwriting another's work. This is an edit-version check, **not** an authentication token.
- The server acquires the merchant row lock before reading/updating the draft, matching review, publishing and privacy-redaction lock order. Only that merchant's unpublished draft can change.
- A changed draft invalidates any existing usable review's publication digest **in the same transaction**. The historical review row remains for editorial metrics, but the merchant must inspect and renew approval before publishing. A no-op save leaves the review unchanged.
- Rejected, published, publishing and reconciliation drafts are not editable in this workflow. The UI has a separate, explicit confirmation and verified checkbox for publication.

## Verification and rollout gates

`tests/editorial-edit.test.ts` covers corrected HTML sanitization, review invalidation and renewal, no-op review preservation, stale form rejection, tenant isolation, redaction, immutable published/rejected states, and invalid/weak inputs. CI must pass SQLite and PostgreSQL before treating the change as verified.

Still required: authorized Shopify development-store browser test with two concurrent merchant sessions, theme rendering, long Unicode HTML, large article body, session expiry/uninstall races and accessibility review. No real merchant conversion, organic traffic, acceptance rate or minutes saved have been observed.

## Outcome experiment (pilot only, with consent)

Record merchant-initiated `article.edit` actions (no draft text or URLs in the activity log) and existing voluntary review minutes. Compare **useful approved drafts / generated drafts**, **review minutes per usable draft**, **rejection reasons**, and **time to first reviewed draft** for a small consented pilot. Distinguish new vs returning merchants, track denominator and cohort dates, and do not infer causality from before/after observations. Do not call a score increase traffic or revenue growth. If usage is low or edits add more time than they save, prioritize reducing edit friction rather than more AI generation.

**Sources:** [Shopify: adding and managing blog posts](https://help.shopify.com/en/manual/online-store/blogs/writing-blogs/working-with-blog-posts); [Shopify: rich text editor and HTML cautions](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/rich-text-editor); [Google: helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).


## Stale review-form prevention (2026-10-28)

A publication approval fingerprint alone does not prevent a second merchant editor from changing an article **between the first editor opening the review screen and submitting their decision**. Previously the server calculated a digest of the *new* draft at submission, potentially approving content the reviewer never saw. Rejections could likewise discard a corrected draft.

The Blog Agent now supplies a versioned SHA-256 review-form fingerprint of the displayed title, body, excerpt, tags, editorial keyword, destination blog and author. The review service requires that exact fingerprint and recomputes it inside the merchant-locked transaction for **both usable and rejected decisions**. Missing, malformed, or stale versions fail closed with a refresh instruction; a new review must be explicitly submitted after inspecting the updated content. The fingerprint is a version check, not a signature, login credential or proof of actual human reading. This complements, rather than replaces, the existing publisher-side approval digest.

Regression tests in `tests/editorial-review-stale.test.ts` cover missing versions, changed article bodies, changed blog/author, keyword-only changes, stale rejections, and successful explicit renewal. Production and PostgreSQL CI remain the verification gate; real concurrent browser sessions on a Shopify development store are still untested.


## Final browser publication version (2026-10-28)

The final Publish POST is now bound to the exact article **and publication destination rendered when that browser page loaded**, independently of the stored editorial approval. Both the Blog Agent and Store Manager submit a versioned SHA-256 `expectedPublishDigest` derived from the title, HTML body, excerpt, tags, blog ID and author. The publisher requires a correctly shaped version, then compares it with the live tenant-scoped draft and destination **inside the transaction that claims the draft**. Missing, stale or changed versions fail closed before Shopify's `articleCreate` mutation and leave the draft `ready`. The existing human review, status claim and uncertain-response reconciliation remain mandatory.

This closes a distinct race: another editor can edit an article, renew the editorial review, and leave a previously opened Publish form showing older content. The earlier form cannot publish the newly approved content. Both interfaces now expose destination and author; Store Manager also shows the full title, excerpt, tags and HTML preview under its evidence expander. The digest is **not** an authorization token, secret, or evidence of reading. It does not solve a change-and-revert (ABA) sequence where the exact publication payload returns to its original bytes, nor can it prove that the merchant opened the details panel.

Tests include malformed/missing browser versions, post-render article edits followed by fresh review, destination/author changes after render, and existing duplicate-publish/reconciliation/tenant tests. This is isolated application testing, not a live Shopify store integration. Source: [Shopify articleCreate API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate), which allows `isPublished: true` and includes blog, author, body, excerpt and tags in the publication payload.

**Next external validation:** with an authorized development store, open the same draft in two merchant sessions; edit and reapprove in B, then attempt to publish from A's stale page. Expect a safe refresh prompt and zero Shopify article creations. After A reloads and confirms the new content, expect one article, correct blog/author/tags, and no replay after a simulated lost response.
