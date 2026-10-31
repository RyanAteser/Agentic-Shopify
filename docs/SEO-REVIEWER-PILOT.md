# Blinded SEO reviewer pilot (offline, no store writes)

## Purpose
Determine whether the guarded fixed-query-mix Search Console diagnostic **reduces incorrect editorial recommendations**, rather than simply abstaining more. This experiment does not demonstrate organic traffic, conversion or revenue lift.

## Design
1. Obtain explicit consent for read-only GSC access. Export comparable 28-day windows, keeping property totals separate from query rows. Restrict to the authorized shop/property; do not put tokens, email addresses, customer data, query strings or property names in reviewer score files.
2. Select cases *before* examining model output, across high/low traffic and high/low export coverage. Avoid cherry-picking only CTR reversals. Use at least 30 independently adjudicated cases as a minimum operational screen, not a statistical power claim.
3. Two reviewers independently inspect the same redacted evidence and record whether an SEO change is justified, not whether CTR merely moved. Blind reviewers to whether the baseline or guarded diagnostic produced each recommendation. Adjudicate disagreements without exposing the original system labels.
4. Record baseline and guarded decisions as `change`, `no_change` or `abstain`; adjudication as `change`, `no_change` or `unknown`. Use opaque case IDs. Keep cases paired.
5. Run `node scripts/seo-reviewer-evaluation.mjs --self-test`, then `node scripts/seo-reviewer-evaluation.mjs path/to/assessments.json`. The script never calls Shopify, Google, n8n or the network.

Example input (synthetic only):
```json
[
  {"caseId":"case-001","baseline":"change","guarded":"no_change","adjudicated":"no_change"},
  {"caseId":"case-002","baseline":"change","guarded":"abstain","adjudicated":"unknown"}
]
```

## Decision criteria
Report adjudicated sample size, baseline and guarded error counts, abstentions, disagreements, corrections and regressions. Also report actionable counts and actionable coverage (actionable/adjudicated) for each arm, plus error rates conditional on an actionable decision (wrong/actionable). Null error rates mean there were no actionable cases, not zero errors. These rates are descriptive and should not be interpreted as statistically significant without a prespecified power analysis. **Never count abstention as a correct recommendation.** Do not calculate precision or claim a win when denominators are too small or when adjudication is unknown. Require no increase in harmful actionable errors and evidence of fewer incorrect recommendations *at comparable actionable coverage* before merchant-facing recommendations. A reduction achieved only by refusing nearly every case is not success.

Treat changes in GSC click-through rate as observational, not causal: search position, query intent, device, geography, seasonality, Search appearance and anonymized query coverage can change simultaneously. Reviewers must be able to mark evidence inconclusive. Store raw consented exports only in approved tenant-isolated storage with retention/deletion controls. Never commit them to GitHub.

## Stop / release gate
If 30 adjudicated cases cannot be collected, if inter-reviewer agreement is poor, if export coverage is inadequate, or if the guarded version increases wrong actionable recommendations, remain offline and do not integrate into merchant advice. Even a successful reviewer study does **not** establish merchant revenue lift; that requires a separate consented longitudinal pilot.

References: [Google Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) (top-row ordering and non-exhaustive coverage); [Search Console performance report](https://support.google.com/webmasters/answer/7576553) (query anonymization and aggregation caveats).

## Abstention tradeoff and paired comparison
The evaluator now reports `errorsAvoidedByAbstention` separately from `corrected`. An incorrect baseline decision followed by a guarded abstention is **not** a correction. It also counts `correctDecisionsLostToAbstention`, where a valid baseline decision becomes unavailable. These counts must be reviewed alongside actionable coverage, not presented as merchant gains.

`pairedActionable`, `pairedBaselineErrorRate` and `pairedGuardedErrorRate` describe only adjudicated cases where **both** systems made actionable decisions. The paired subset can be selectively easier than abstained cases; never use its conditional error rates alone to establish superiority. Rates are null when the paired denominator is zero. `evidenceSufficient` only means 30 adjudicated cases were supplied; it does not approve release or establish statistical significance.

The preferred next experiment is a prespecified, consented reviewer study that records the cost of incorrect changes, the cost of missed useful changes and reviewer time. Do not tune thresholds on the held-out evaluation set.
