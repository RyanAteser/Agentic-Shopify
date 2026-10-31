# Fixed-query-mix CTR diagnostic (offline research)

`compareFixedQueryMix` holds **previous-period impression weights** constant across returning queries when measuring current CTR. It reports:

- `withinQueryEffect = fixedPreviousMixCurrentCtr - previousCtr`
- `mixEffect = currentCtr - fixedPreviousMixCurrentCtr`

These sum exactly (before floating-point rounding) to the observed matched-query CTR change. A falling matched CTR can therefore coexist with improving CTR for each returning query when impressions shift toward low-CTR queries. This is an accounting decomposition, not a causal attribution.

## Preconditions and limits

Use only with explicitly consented, tenant-scoped, equal-length finalized Google Search Console exports and **first run `assessPairedQueryMix`** against independently fetched property totals. The fixed-mix helper does not perform that preflight itself and is not connected to recommendations, publishing or a live store. Match the same property, page, device, country, search type and appearance filters in both periods. Query-level comparisons can still hide page-level shifts. A returning query with zero impressions in either period causes abstention because its CTR is unobserved. A minimum of five matched queries and 100 matched impressions per period is required.

A query absent from an export may be anonymized or truncated, not genuinely new or lost. Google does not guarantee complete query rows. Neither coverage heuristics nor this decomposition prove ranking, sales, conversion or qualified traffic changes. Do not use it to automatically rewrite merchant content.

## Evaluation

The regression suite checks Simpson-style composition reversal, exact component reconciliation, identical weights, missing exposure, sparse cohorts, duplicate rows and unsafe integer sums. Next: use consented, independently reconciled exports, then blind-review cases where aggregate and standardized CTR disagree. Measure abstention and reviewer error rates before advisory integration.

Source: [Google Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).
