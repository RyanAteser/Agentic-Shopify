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
