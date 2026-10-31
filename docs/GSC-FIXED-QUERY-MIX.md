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

## Guarded entry point (2026-10-31)

Use `assessFixedQueryMix(previous, current, previousPropertyTotal, currentPropertyTotal)` for any new research consumer. It invokes `assessPairedQueryMix` first and returns only a `status` and `reason` if property export coverage or matched-cohort click/impression coverage fails. If preflight passes, it invokes the existing fixed-weight computation; missing exposure can still cause abstention. The lower-level `compareFixedQueryMix` remains available for pure mathematical tests, but bypasses independent coverage checks and must not be used directly to generate merchant-facing advice.

This is a code-level guard, not a verification of consent, tenant ownership, identical Search Console filters, finalized reporting windows, or real merchant outcomes. Those remain upstream requirements. No recommendation or publication pathway is enabled.

## Invalid-export failure policy (2026-10-31)

The guarded `assessFixedQueryMix` entry point now abstains with `{status:"withheld",reason:"invalid_rows"}` for known validation failures: malformed or duplicate query observations, unsafe integer aggregates, invalid independent property totals, or query totals exceeding property totals. This prevents invalid exports from producing either partial SEO effect estimates or unhandled input-validation errors in future advisory consumers. Unexpected programming errors still propagate rather than being silently masked.

Synthetic regression tests cover duplicate and non-finite query observations, inconsistent property totals, and negative property totals. This change does not verify real Google exports, merchant consent, equivalent filters, or any merchant outcome.
