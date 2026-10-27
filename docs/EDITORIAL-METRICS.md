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
