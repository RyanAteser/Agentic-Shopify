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
