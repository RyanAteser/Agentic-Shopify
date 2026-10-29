# Offline GSC corroboration for SERP ranking alerts

**Research only. No merchant growth, alert precision or revenue impact has been measured.** This tool does not connect to Google, n8n, Shopify or Bright Data, and never publishes or edits content. It assesses one Google ranking incident against an independently exported, consented Google Search Console (GSC) Search Analytics response. It is not wired into production alerts.

## Why this exists

The existing SERP replay compares a naive two-snapshot reference against a three-distinct-day rule, but a SERP rank change is not itself lost merchant traffic. GSC Search Analytics supplies observed clicks and impressions for a defined query/page/country/device cohort. It cannot establish why a change happened, whether an alert caused merchant action, or revenue impact.

Run locally:

    npx tsx scripts/gsc-rank-evidence.ts ./consented-one-incident.json

The file contains sensitive merchant search queries and must not be committed. The aggregate output intentionally omits page URL, keyword, tokens, shop ID and raw observations.

## Export contract

Collect only with explicit merchant permission, using the exact HTTPS URL-prefix GSC property matching the storefront host and the webmasters.readonly scope. For each Google incident, export the GSC response to a Search Analytics query with:

- siteUrl: exact storefront property, e.g. https://shop.example/
- dimensions: exactly ["date"]; type: "web"; dataState: "final"; aggregationType: "auto" or "byPage"
- One AND group containing exactly four equals filters: query (exact case-sensitive incident keyword), page (exact incident URL), country (GSC ISO 3166-1 alpha-3 lowercase, e.g. usa), device (GSC uppercase DESKTOP, MOBILE or TABLET)
- startDate: seven Pacific calendar days before the incident; endDate: seven days after; exclude the incident's Pacific date from the two seven-day comparisons
- rowLimit at least 15 (recommend 1000) and startRow 0
- The response must report responseAggregationType "byPage" and contain Google's original date-keyed rows (keys, clicks, impressions, ctr, position).

Save one JSON object with keys primaryHost, incident, request and response. The incident contains keyword, targetUrl, country, device, engine "google" and ISO-8601 observedAt. The request object should include the exact GSC query metadata and siteUrl; the response should be the returned Search Analytics JSON. Do not include OAuth tokens or API keys.

The validator rejects mismatched property, target, country, device, keyword, dates, duplicate observations, fresh data, invalid metrics, wrong aggregation, non-Google incidents and unscoped filters. The full seven-day followup must also end at least three Pacific calendar days before evaluation, even if the export claims finalized data. It reports before/after clicks, impressions, CTR, impression-weighted average position and absolute changes. The `evidenceStatus` field is `incomplete_dates`, `low_volume` or `descriptive_only`. Percent changes are withheld unless all 14 comparison dates exist, baseline clicks are at least 10, and each seven-day window has at least 100 impressions. These deliberately conservative **product screening thresholds are not statistical significance tests or Google recommendations**. Absolute deltas are still reported for complete low-volume cohorts, with no implied alert or causal attribution. If any date is absent, even absolute deltas are null. A row omitted by Google is unknown, not a measured zero.

## Interpretation and experiment

1. Freeze a pre-registered set of ranking incidents, including both alerts and candidate missed incidents. Select independent merchant reviewers and record usefulness labels before viewing GSC comparisons.
2. Export exact cohorts from an authorized GSC property, then run the offline CLI. Keep original exports encrypted, tenant-scoped and out of GitHub.
3. Compare incident-level alert precision, missed material traffic declines and detection delays on a held-out period. Report `low_volume` and `incomplete_dates` abstentions separately; do not count them as negative outcomes or false positives. Stratify by baseline impressions and seasonality. Report abstentions due to missing dates, privacy-filtered queries or incomplete exports.
4. A negative change in clicks or impressions is descriptive evidence, not proof of a ranking error, algorithm quality or lost sales. Do not promote the tool to an automated merchant recommendation until it survives real data and reviewer validation.

GSC uses Pacific reporting dates while SERP replay uses UTC dates. This tool aligns the incident timestamp to Pacific time and excludes its date, but the comparison remains retrospective. GSC hides some queries for privacy and returns top rows rather than guaranteed exhaustive query-level data. Seven reported dates in each window do not establish complete coverage. Search Console average position differs from a single scraped SERP position. Demand, seasonality, search features, canonicalization and merchandising changes may explain differences. Bing incidents cannot use GSC evidence.

## Primary sources

- [Search Analytics query API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query): country/device codes, Pacific dates, filters, aggregation, finalized data, row limits
- [Search Analytics resource limitations](https://developers.google.com/webmaster-tools/v1/searchanalytics): missing dates, top rows and privacy limitations
- [Debugging Search traffic drops](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops): seasonality and traffic diagnostics
- [Using Search Console and Analytics data for SEO](https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console): cohort alignment and clicks versus sessions

Release gates remain in [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md). This tool does not resolve OAuth verification, live Shopify testing, n8n licensing, consent, deployment or merchant outcome validation.

## Sparse-traffic screening (Oct 28, 2026)

The initial offline evaluator exposed percentage changes whenever all reporting dates were present. A seven-click baseline followed by zero clicks can read as a 100% decline while involving only seven observed clicks. The revised output keeps raw counts and absolute deltas but abstains from percentage comparisons for sparse cohorts. The 10-click/100-impression thresholds are predeclared heuristics for avoiding misleading headline percentages, not a calibrated merchant impact threshold. The evaluator does **not** issue a merchant alert or assign statistical confidence. A future consented pilot should measure how often these abstentions occur, review whether genuinely important low-volume declines are missed, and calibrate the thresholds on held-out merchant outcomes. See Google's [Search Analytics API limitations](https://developers.google.com/webmaster-tools/v1/searchanalytics) and [traffic drop debugging guidance](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops).

## Optional pre-incident trend check (Oct 29, 2026)

A seven-day click decline after a scraped rank incident is weak corroboration when the same query/page was **already declining before the incident**. To expose this confounder without adding live access or changing existing exports, the offline evaluator also accepts an **exact 22-day** GSC export:

- Set `startDate` to **14 Pacific dates before** the incident, and keep `endDate` at **7 dates after** it. Keep the same exact query/page/country/device filters, `dataState: "final"`, `dimensions: ["date"]`, `responseAggregationType: "byPage"`, and `startRow: 0`.
- Set `rowLimit` to **at least 22** (1000 recommended). The incident day is excluded from comparisons.
- The new `pretrend` section compares days -14 through -8 (prior baseline) with days -7 through -1 (immediate baseline). The original `baseline` versus `followup` comparison is unchanged (days -7 through -1 versus +1 through +7).
- `pretrend.status` is `not_requested` for existing 15-day exports, `incomplete_dates` when a prior date is absent, `low_volume` for insufficient prior/baseline volume, or `descriptive_only` when both complete windows meet screening thresholds. It never calls an observed pretrend statistically significant.
- Missing prior days never become zero. They suppress pretrend deltas, but do not suppress an otherwise complete original before/after comparison. Both the original and pretrend percentages remain descriptive, not causal.
- A continuing decline before and after the incident is a reason to investigate search demand, seasonality, page changes and other causes. A flat prior baseline does **not** prove the rank incident caused the subsequent decline. The post-incident seven-day window is also shifted by one weekday relative to the immediate baseline because the incident day is excluded.

This extends the **diagnostic context**, not merchant outcomes. The first real-data experiment should preregister both 15-day and 22-day comparisons and report how often the pretrend changes reviewers' conclusions, including sparse and privacy-filtered cohorts. Do not select the export length after viewing the incident's results.

Primary references: [Google Search Analytics query API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) and [Google's traffic-drop diagnostics](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops).
