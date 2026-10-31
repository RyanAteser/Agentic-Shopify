# Offline query-mix diagnostic (research only)

The pure `compareQueryMix` function in `app/lib/gsc-query-mix.ts` compares two separately exported, consented Search Console query cohorts. It is **not connected to the merchant dashboard, OAuth sync, recommendations, or publishing**.

## Why this matters

An overall CTR decline can occur even if CTR improves for every returning product query, when new broad queries introduce many low-CTR impressions. This is a composition effect, not necessarily a title or snippet problem. The function reports total CTR and matched-query CTR separately, alongside counts of new and disappeared queries. It deliberately does not invent zero impressions for missing query rows.

## Collection and privacy

Use only the merchant's explicitly authorized exact HTTPS URL-prefix Search Console property and the read-only scope. Export equal, finalized Pacific-date windows with the same page, country, device, search type, and search appearance filters. Use `dimensions: ["query"]` consistently. Do not commit merchant queries, URLs, tokens or raw exports. Keep exports tenant-scoped and access-controlled; the function performs no I/O.

Google's Search Analytics API returns top rows, anonymizes some queries and does not guarantee exhaustive coverage. Query counts, new/lost labels and matched CTR are therefore **within the exported rows only**, not an exhaustive representation of the site's search traffic. Even a matched query can change intent mix, SERP features, devices or average position. Do not infer causality or recommend automated title changes.

The function rejects duplicate, malformed, negative, inconsistent and unsafe-number rows. It labels a comparison `descriptive_only` only when at least five queries match and both matched cohorts have at least 100 impressions. Otherwise it labels `insufficient_coverage`. These thresholds are conservative product heuristics, not statistical significance or an estimate of sampling completeness. It does not gate publication or merchant-facing decisions.

## Validation before integration

1. Confirm a consented export's query-row totals against the corresponding date-only property report, and quantify omitted impressions and clicks. Do not assume full coverage.
2. Freeze matched query keys before looking at outcome deltas. Stratify branded/nonbranded and page cohorts with a documented, privacy-preserving classifier.
3. Evaluate multiple held-out 28-day windows and manually review examples where aggregate and matched CTR trends disagree. Record abstentions, missing rows and query-coverage ratios.
4. Only consider advisory integration after reviewer validation and tenant-isolation tests. No claim of traffic, conversion or revenue improvement is warranted.

Sources: [Google Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [Search Analytics resource limitations](https://developers.google.com/webmaster-tools/v1/searchanalytics), [Google traffic-drop debugging](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops).

## Query export coverage preflight (2026-10-30)

The pure `assessQueryExportCoverage` helper compares exported query-row click and impression sums with an **independently fetched, identically filtered property-level total**. A cohort is `usable_for_review` only when both click and impression coverage reach 80%, totals are positive, and the export does not exceed the property totals. Missing/zero denominators, duplicate rows, invalid counts and mismatched filters abstain or throw. This 80% threshold is a conservative review heuristic, **not** proof of completeness or statistical representativeness.

For a two-period comparison, apply the check **separately to both periods** and withhold merchant-facing interpretation unless both pass. This helper is deliberately not wired to the dashboard or automatic recommendations. Search Console may anonymize queries, cap returned rows, and change reporting coverage; totals must be collected with the same property, dates, dimensions-independent filters and search type. A failure may reflect export truncation, anonymization or filter mismatch, not lost traffic.

CI regression cases include 40% coverage, full coverage, impossible row sums, zero totals and duplicate query keys. No real merchant exports were used, and no SEO lift is claimed.

## Paired-cohort guard (2026-10-30)

Use `assessPairedQueryMix` rather than treating `compareQueryMix`'s descriptive label as permission to advise merchants. The paired guard requires each period's export to cover at least 80% of independently retrieved property clicks **and** impressions, at least five returning queries with 100 matched impressions per period, and matched queries to represent at least 50% of each period's exported impressions. It returns `withheld` and a reason when any guard fails. The 50% rule prevents a tiny matched cohort from being portrayed as the entire export. All thresholds are heuristic and do not eliminate query selection bias or validate a causal SEO claim. No live data was processed.

## Matched-click representativeness (2026-10-31)

A matched cohort can cover most impressions but almost none of the clicks. For example, five returning queries with 500 impressions and 5 clicks plus one newly observed query with 100 impressions and 50 clicks yield 83.3% matched-impression coverage but only 9.1% matched-click coverage. Treating the returning-query CTR as representative would obscure the vast majority of observed visits.

The paired guard now additionally requires matched queries to account for at least **50% of exported clicks in each period**, with positive click denominators. It exposes matched and total click counts for auditing. This is a conservative abstention policy: it may withhold legitimate observations, and passing does not establish causality, representativeness of anonymized queries, qualified visits, sales, or statistical significance. Both periods must still pass the independently checked property-level export coverage gate. Synthetic regression tests cover the high-impression/low-click matched cohort and zero-click exports. The helper remains offline and advisory-only; no merchant data or store changes are involved.
