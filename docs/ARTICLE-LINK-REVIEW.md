# Merchant link review inventory (development branch)

The Blog Agent now presents a **read-only, bounded list of unique links** extracted from the sanitized article preview before human approval. The list distinguishes store-relative links from absolute HTTPS destinations, shows duplicate occurrences, and explicitly warns when the display omits links after the first 20.

This solves a specific review-workflow problem: a merchant previously had to manually search long HTML drafts to find every proposed product or source link. The inventory makes link checking easier, but does **not** fetch destinations, prove that products exist, verify claims, or assert that any source is trustworthy. A merchant must still inspect links, factual claims and brand fit before approving or publishing.

## Safety and boundaries

- Extraction parses the same sanitized preview used in the UI, never raw untrusted draft markup. Unsafe or removed links cannot be presented as approved links.
- Legacy HTML that would be modified by sanitization carries an explicit warning. Oversized or malformed previews do not expose unreviewed raw HTML.
- Display is capped at 20 unique destinations, with total unique and occurrence counts. Truncation is always disclosed. No URLs are fetched, logged to external services, or sent to new third parties.
- The feature does not alter stored drafts, editorial digests, Shopify products, publishing permissions, generation credits, or any active store.
- Absolute HTTPS links may point to the merchant's own domain or third parties. Host labels are informational, not provenance attestations.

## Validation and pilot hypothesis

Automated tests cover duplicate destinations, HTML entities, unsafe link removal, oversized legacy HTML, and truncated inventories. For a consented pilot, measure **time to verify links per draft**, **incorrect links discovered per draft**, and **draft acceptance**, including rejected drafts. Compare against a review flow without the inventory, randomized or counterbalanced where possible. No time savings, traffic, conversion, ranking or revenue impact has yet been measured.

Google's people-first content guidance emphasizes accurate, useful content and trustworthy sources rather than producing more articles: https://developers.google.com/search/docs/fundamentals/creating-helpful-content

## Anchor-text review signals (2026-10-30)

The same sanitized link inventory now counts two **high-confidence editorial prompts** across all link occurrences, including links beyond the 20-URL display cap:

- **Missing anchor text:** no visible text and no `title` fallback. Google can use `title` when text is absent, so a descriptive title is not flagged.
- **Generic anchor text:** a narrow exact-match set (`here`, `click here`, `read more`, `learn more`, `more`, `link`), ignoring case, whitespace and trailing sentence punctuation. Nested formatting and HTML entities are parsed by `sanitize-html`, not a raw HTML regex.

Both totals and per-destination counts are read-only and do not block publication. A generic call to action may be intentional, and language-dependent patterns may be missed. These are **not** Google ranking factors, accessibility certification, factual verification, or a substitute for human inspection. Unsafe stripped links are not counted as safe links or review signals. No network requests, extra Shopify scopes, database migrations or n8n changes.

Google's official link guidance recommends concise, descriptive anchor text and warns against generic phrases:
https://developers.google.com/search/docs/crawling-indexing/links-crawlable

**Pilot test:** Randomize or counterbalance review with versus without anchor prompts. On *all* reviewed drafts, record (a) missing/generic links confirmed by merchants, (b) time to resolve each, (c) false-positive rate, and (d) draft acceptance and corrections. Pre-register outcomes; do not equate more flags with improved SEO or merchant value. Avoid publishing or editing stores automatically.
