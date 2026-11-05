# Editorial outcomes: merchant pilot measurement contract

**Status:** Read-only development dashboard, not live merchant evidence.

The Growth page now shows a rolling 28 x 24-hour editorial snapshot using only
authenticated, shop-scoped application records. It does not query orders,
buyers, checkout, or new Shopify permissions.

## Exact definitions

- **Generation requests created:** count of ContentJob rows with `createdAt`
  inside the rolling window. Includes queued, running, completed, failed and
  uncertain jobs. Failed and `dispatch_uncertain` are displayed separately.
- **Drafts created:** count of ArticleDraft rows with `createdAt` inside the
  same window, regardless of their associated job's creation date.
- **Current draft outcomes:** count of that draft cohort in `published`,
  `rejected`, `ready`, `needs_review`, `publishing`, and
  `needs_reconciliation` at the time the merchant views the page.
- **Published among resolved:** published / (published + rejected), displayed
  only with **at least five resolved decisions**. Pending or uncertain drafts
  are excluded from this denominator and always displayed separately.
- **Do not divide drafts by requests:** these are separate creation-date cohorts
  and a job created just before the cutoff may create a draft after it. That
  ratio would falsely imply generation delivery reliability.
- **Do not call the published share an acceptance rate:** merchants currently
  have publish and reject actions, but not a distinct recorded accept/edit
  decision. Published is only a proxy for a positive editorial decision.
- **Do not infer revenue:** no orders, checkout conversion, or sales attribution
  are connected. Google Search Console site clicks are separate observational
  metrics, not evidence of revenue lift or causal blog performance.

## Pilot evaluation

For consented test merchants, capture a pre-registered weekly cohort summary
with the exact reporting window, sample size, draft rejection reasons and
publication/reconciliation counts. Manually score a blinded sample for factual
accuracy, source validity, originality, merchant-specific usefulness, product
link correctness and editing time. Include rejected and unpublished drafts,
not just successes. Separately track 28-day merchant return rate, organic GSC
coverage and qualified traffic after sufficient indexing lag. Compare to a
plausible counterfactual; don't claim causal lift from before/after alone.

**Next engineering milestone:** add an explicit human `accepted`/edited event,
with review timestamp and optional editing minutes, before presenting a true
editorial acceptance rate or time-saved estimate. Consider Shopify's new
Analytics/App Events platform only after eligibility, merchant consent,
privacy/data-minimization review and developer-preview availability checks.
Never send merchant or buyer identifiers into event payloads.

References:
- Google Search Central, people-first content:
  https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Shopify Analytics app platform:
  https://shopify.dev/docs/apps/build/analytics
- Shopify App Events privacy and preview:
  https://shopify.dev/docs/apps/build/app-events

## Review renewal and evidence freshness (2026-10-28)

A usable editorial review is bound to the exact publication fields and selected Shopify blog/author by a stored content digest. A changed draft or destination requires another explicit review before publishing; legacy usable reviews without digests are not sufficient. Renewing an outdated usable review **updates the same row** with the latest review timestamp and optional self-reported minutes; it does not create a second review event. Therefore the 28-day review-decision cohort measures **most recent recorded review timestamps**, not unique lifetime first reviews or total review actions. Never interpret the renewal as proof of increased productivity, fact-checking quality or conversion.

## Explicit review evidence (2026-10-27)

The Blog Agent now records **usable as written** or **rejected** decisions,
separately from publishing. Usable reviews require a human checkbox and a
`ready` draft; `needs_review` drafts cannot be marked usable without
corrections. Rejection still prevents publishing. Neither action publishes or
edits Shopify content; direct publishing remains separately approved and may
occur without a review event.

One `EditorialReview` row per (shop, draftId) is stored transactionally.
Optional self-reported review minutes must be 1–240 whole minutes. They are
**not** a timer, verified work time, or estimated time saved. Rejection
feedback is limited to 1,000 characters. Uninstall/redaction deletes review
records and the transaction locks store configuration first to fence off late
reviews after erasure.

Growth reporting groups **review decisions made in the past 28 x 24 hours**,
independent of the draft-creation cohort. Usable share is displayed only with
at least five decisions; mean self-reported minutes always includes its sample
size. This is a voluntary subset, not a population acceptance rate: direct
publication and missing reviews introduce selection bias. No productivity,
SEO or revenue improvement is claimed.

Next pilot: pre-register eligible drafts, track review participation and
minutes coverage, blind-score factual quality and product links, and compare
review time against human-written controls. Google's people-first guidance
prioritizes usefulness over raw automated article volume:
https://developers.google.com/search/docs/fundamentals/creating-helpful-content

## Cohort-aligned review participation (2026-10-30)

The Growth dashboard now adds a **draft-creation-date cohort** to complement
the separate review-decision-date cohort. The denominator is **every draft
created in the last 28 x 24 hours** for the authenticated shop, including
pending, rejected, published, and reconciliation statuses. The numerator is
the number of those draft IDs with a recorded usable or rejected review,
regardless of the review's timestamp. This avoids interpreting voluntary
review submissions alone as merchant-wide editorial adoption.

- Display counts for recorded, unrecorded, usable, rejected, and historically
  published drafts lacking a recorded review. The latter is a diagnostic for
  legacy/imported data, **not** evidence that the current publisher can bypass
  the mandatory current usable review.
- Display the percentage only when at least five drafts were created. The
  bounded query loads only IDs and statuses for at most 1,000 drafts and
  corresponding decisions. Above that cap it abstains entirely, never
  presenting a partial cohort as complete.
- The creation-date cohort is **not** the review-date cohort, a publication
  rate, an up-to-date review-approval count, or a randomized treatment effect.
  Review renewal updates the same row. A usable decision may become stale
  after a draft edit, and the metric does not imply a factual check occurred.
- All queries filter by authenticated shop; no article body, merchant content,
  buyer data, order data, new permissions, or third-party tracking are required.

**Pilot design:** Pre-register a set of eligible drafts and compare the
percentage with recorded decisions, draft acceptance after blinded factual
review, confirmed product-link errors, and optional self-reported review time.
Include unresolved and rejected drafts. A high coverage rate is not proof
of helpful content or sales. Google's guidance explicitly prioritizes
original, accurate, people-first content over automation volume:
https://developers.google.com/search/docs/fundamentals/creating-helpful-content

Shopify's analytics platform may eventually support separately consented
merchant outcome measurement, but that is not authorized or implemented here:
https://shopify.dev/docs/apps/build/analytics

## Denominator visibility and unresolved-backlog guard (2026-10-30)

A merchant can have five published and five rejected drafts, alongside ninety drafts still awaiting review. The previously displayed **50% published among resolved** is mathematically correct but potentially misleading when read without its denominator. The Growth dashboard now also reports **10% resolved coverage** (10/100) and **5% published among all created drafts** (5/100). These numbers are a synthetic unit-test illustration, **not actual merchant results**.

- Resolved coverage = (published + rejected) / all drafts created in the same 28-day creation cohort. It is a status snapshot, not the proportion of all jobs successfully delivered.
- Published among all created drafts = published / all created drafts. This is an observed-to-date fraction, not a final acceptance rate: pending drafts may be published later.
- Both additional percentages are withheld until at least five created drafts exist. The resolved-only publication percentage still requires five resolved decisions.
- No extra API calls, scopes, content reads, personal data, store writes or billing changes. All counts are already grouped by authenticated shop.
- Invalid aggregate totals exceeding JavaScript's safe integer range now fail closed rather than silently corrupting displayed percentages.

**Impact hypothesis:** Exposing the pending denominator prevents teams from mistaking a high resolved-only share for widespread content acceptance and directs attention toward review bottlenecks. This is an observability improvement, not a demonstrated reduction in labor or increase in sales. Validate against consented merchant usability sessions and eventual draft outcomes, including the age of unresolved drafts. No evidence of improved retention, SEO, conversions or revenue has yet been collected.

## Actionable queue versus historical missing-review evidence (2026-10-30)

The dashboard now distinguishes **ready** and **needs_review** drafts without a recorded editorial decision from the broader set of drafts missing review rows. The former is the actionable editorial queue; the latter includes published, rejected and reconciliation statuses and should not be described as merchant review work awaiting action. Both are shop-scoped creation-date cohorts, capped at 1,000 drafts with no partial metric when exceeded. For each, counts at 7 and 14 days and oldest age use draft **creation time**, not the moment it entered its present status. This is a descriptive diagnostic, not a measure of true queue wait time or merchant abandonment. The historical missing-review count is retained for audit of imported/legacy records and operational exceptions. No new permissions, customer data, writes, publishing or billing are involved.

**Hypothesis:** Separating actionable review work from historical data-quality exceptions reduces false prioritization and makes merchant workflows easier to triage. Validate with consented merchant support sessions and actual review-resolution timestamps before asserting time savings. A status-transition event history would be required for reliable queue latency, but is not collected here.
