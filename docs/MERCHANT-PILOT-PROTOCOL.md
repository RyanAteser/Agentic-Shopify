# Merchant pilot: falsifiable value and safety protocol

**Status:** Proposed protocol only. No merchant consent, live install, publication, traffic, revenue or time-saving evidence is implied. This is a companion to [EDITORIAL-METRICS.md](EDITORIAL-METRICS.md) and [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md), not a replacement for launch gates.

## Decision being tested

For a consenting merchant, does the human-reviewed Blog Agent produce *usable, factually accurate, merchant-specific drafts* at lower **total human labor plus provider cost** than a comparable manual workflow, without increasing unsafe claims or publication incidents? SEO clicks and revenue are secondary, observational outcomes until a controlled design and sufficient follow-up exist. Generating more drafts is not success.

## Preregister before first eligible draft

Record pilot ID, merchant consent timestamp and revocation contact, store's internal pseudonymous ID, product/category scope, dates, selected Shopify blog, manual-workflow comparator, AI model and prompt versions, n8n workflow revision, per-draft provider-cost method, and who independently reviews quality. Store no buyer/order data or API tokens in research exports. Assign eligible topics **before** seeing generated outputs. Include failures, rejected drafts and unfinished reviews in the analysis population.

Recommended small feasibility pilot: 2–3 consenting merchants, at least 10 paired topic briefs per merchant (one AI-assisted and one manual draft per comparable brief, with order counterbalanced). This is **not powered** to detect traffic or revenue lift. Avoid publishing duplicate versions of a topic. Keep all drafts unpublished unless the merchant separately approves each exact payload. If paired production is infeasible, label the design observational and do not infer causality.

## Assignment and analysis safeguards (preregistered)

**Unit of assignment:** the eligible topic brief, not the generated draft. Construct topic pairs within each merchant using predeclared difficulty, product category, expected word count and research burden. Randomize one brief in each matched pair to AI-assisted drafting and the other to manual drafting *before* generation. Do not let one writer see the other arm's draft or supporting notes. Counterbalance author/reviewer and sequence where possible. A single topic drafted twice is a useful blinded quality comparison but **not** an independent paired labor-saving observation: shared research, practice and contamination can bias the second attempt. Report such duplicate-topic observations separately.

**Intention-to-treat denominator:** every assigned brief stays in its original arm, including model failures, no-shows, rejected drafts and abandonment. Track time from initial research through factual verification, edits and final decision; capture the human time spent on unsuccessful work. Record the assignment timestamp, exclusions fixed before randomization, deviations and missingness by arm. Do not silently omit unresolved or failed tasks from the median. Where active time is unobserved, report bounds or sensitivity analyses rather than imputing zero or a favorable duration.

**Primary comparison:** calculate each matched pair's AI-minus-manual active-minute difference, then report the median of differences alongside per-arm distributions, sample sizes and merchant-stratified results. For the separately stated **20% reduction gate**, preregister a dimensionless estimator: for each complete matched pair with strictly positive manual minutes, compute `100 × (manual_minutes − AI_minutes) / manual_minutes`, then take the median of those pair-level percentages. Report the paired absolute-minute median alongside it. A zero-minute manual task makes its percentage undefined and must remain in the assigned-brief accounting, with its exclusion from percentage calculations disclosed; do not add an arbitrary denominator or silently omit it from cost, quality or safety outcomes. Missing minutes in either arm make that pair's percentage unobserved, not zero. Report percent-gate coverage by merchant and arm, plus conservative sensitivity bounds for missing pairs. With very small or imbalanced merchant samples, show merchant-level estimates and do not let one merchant's topic volume silently dominate a claimed general result. The difference between two group medians is **not** the median paired difference. Predeclare a simple uncertainty interval (e.g. merchant-cluster bootstrap when enough merchants exist); with only 2–3 merchants, avoid precision claims or conventional significance tests. Separate reviewer blinding from authorship: reviewers can score redacted drafts blind, but authors necessarily know which tool they used. Report provider charges, hourly labor rate and cost per *assigned* brief, not only accepted drafts.

**Publication and attribution:** only one merchant-approved final article per topic may be published through a separately authorized workflow. Record indexing eligibility, baseline demand, seasonal promotions and concurrent site edits before interpreting Search Console movement. This feasibility pilot cannot isolate search ranking, revenue or conversion effects.

## Operational dry-run gate (development store, no publication)

Run with test-only content, isolated credentials and a merchant-authorized development store. Capture timestamped sanitized request IDs, HTTP status and expected vs observed state; never log tokens or article body.

| Scenario | Expected observable | Stop condition |
| --- | --- | --- |
| Fresh embedded install, reload and expired session | Correct shop-scoped authentication or explicit reauth; no blank iframe | Session loop, wrong-shop data or silent empty screen |
| Two concurrent merchant sessions edit the same draft | One edit succeeds, stale version conflicts; current review invalidated | Lost update or publishable stale approval |
| Wrong-shop request for draft, recommendation or GSC data | Denied with no cross-tenant read/write | Any tenant data disclosure |
| Valid review then title/body/blog change | Publication blocked until new explicit review | Changed payload remains publishable |
| Stale Publish browser tab after another review | Stale fingerprint rejected; no Shopify write | Any stale-tab publication |
| n8n POST timeout after ambiguous acceptance | Uncertain state, no automatic resend/credit refund | Duplicate generation or unbounded retry |
| Crash after outbox dispatch claim | Operator reconciliation required; no automatic replay | Blind duplicate delivery |
| Forged Shopify webhook and replayed valid webhook | Forgery rejected; valid replay idempotent | Forgery accepted or cross-shop deletion |
| Uninstall and data redaction | Tokens, merchant records and metrics erased as documented | Residual scoped data or late write |
| Google consent revoked / missing property | Read-only metrics stop; no fabricated zeros | Continued access or fabricated results |

Do not enable the n8n scheduler, live billing, store publishing, app-scope changes or deployment as part of this dry run. Record failed cases as actionable issues with minimal redacted reproductions.

## Outcome capture per eligible topic

Record: assignment ID; cohort/merchant; topic brief and difficulty band; assigned workflow; start/end of **active human work** (not elapsed queue time); factual-check minutes; editing minutes; external provider cost; completion/abandonment; reviewer blind score (1–5) for factual support, originality, product-link correctness, usefulness and brand fit; material-claim error count; merchant decision (accepted, edited, rejected, unresolved); and any privacy/publishing incident. For AI, include prompt/model version and generation failures. Do not replace missing minutes with zero. Distinguish self-report from timed observation.

Primary endpoint: median total human active minutes **per eligible brief**, including time spent on rejected or failed drafts; report missing-time coverage and merchant-level paired differences. Cost endpoint: human minutes valued at a predeclared hourly rate plus measured provider charges per eligible brief. Quality guardrail: independently audited unsupported material claims per reviewed draft and severe errors per eligible brief. Secondary: usable-draft rate, time-to-decision (not active labor), return usage after 28 days, and opt-in GSC page/query observations after indexing. Do not interpret GSC position, clicks or CTR changes as causal effects without comparable controls, stable page eligibility and sufficient coverage.

## Precommitted decision gates

- **Safety gate:** any cross-tenant leak, unauthorized Shopify write, bypassed review, duplicate charge or privacy-erasure failure blocks pilot expansion immediately, regardless of average quality.
- **Measurement gate:** if active-time coverage is below 80% of eligible briefs in either arm, do not claim time savings. Publish counts and missingness instead.
- **Quality gate:** if an AI-assisted arm has any uncorrected high-severity product/medical/legal claim or demonstrably worse independent factual accuracy, do not recommend scaling content production.
- **Feasibility signal (not proof of lift):** at least 20 paired eligible briefs overall, 80% time coverage, no safety incidents, non-inferior blinded quality, and a median paired reduction of at least 20% in active human minutes, with merchant-level results shown separately. Treat this as a *go to a larger controlled pilot*, not a validated merchant benefit.
- **No-go / inconclusive:** sparse samples, high rejection, selective missingness, large merchant heterogeneity or poor review adoption require a revised workflow and another preregistered test, not cherry-picking published successes.

## Offline paired accounting implementation

Use `python scripts/pilot_pair_estimator.py path/to/consented-pilot.csv` with columns `merchant_id,pair_id,arm,active_minutes`; each matched pair requires one `ai` and one `manual` row. Empty minutes mean missing, **not zero**. CI also runs this test suite explicitly (the existing `test_merchant*.py` glob does not include it). Run `python -m unittest discover -s tests -p 'test_pilot_pair_estimator.py' -v` to exercise zero denominators, incomplete pairs, duplicate assignments, nonfinite durations and merchant stratification.

The estimator returns paired absolute-minute and percentage medians, coverage by arm, merchant-specific estimates and a narrow percentage/measurement gate requiring at least 20 positive-denominator complete pairs and at least 80% complete-pair coverage, in addition to 80% coverage in each arm. It deliberately **does not** certify the full pilot: independent factual quality, safety incidents, minimum sample, consent, missingness sensitivity, provider costs and merchant adoption still require separate review. A passing percentage gate alone is not authorization to scale, publish or claim savings. Use only pseudonymous merchant IDs; never export tokens, customer data or article text.

## Reporting template

Pilot ID and window; consent and design; assignment counts by arm; completed/rejected/unresolved counts; missing-time coverage; median and distribution of active minutes; provider cost per eligible brief; blinded quality scores and severity; merchant-level differences; all incidents and reconciliations; GSC availability and indexing caveats; deviations from protocol; next decision. Explicitly state **no observed revenue/conversion/SEO lift** unless separately verified.

## Sources and constraints

- [Google Search Central: helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content). AI-generated volume is not a quality outcome.
- [Google Search Console performance report documentation](https://support.google.com/webmasters/answer/7576553). Search observations are subject to aggregation and filtering.
- [Shopify app authentication](https://shopify.dev/docs/apps/build/authentication-authorization) and [privacy compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance).
- [n8n Sustainable Use License](https://docs.n8n.io/sustainable-use-license/). Obtain written commercial licensing clearance for the intended merchant-configurable offering before activation.

**Boundary:** This document does not authorize store access, publishing, sending messages, purchases, deployment, billing or any external integration. Merchant approval and the release checklist remain independent requirements.
