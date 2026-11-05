# Monika Blunder Beauty: prospective metadata impact study

**Status: WITHHELD. No authorized changes or Search Console outcomes exist.**
Prepared 2026-11-02 from the six **unapproved** public-page proposals in the accompanying metadata review. This is a study proposal only, not a third-party merchant integration.

## Why this study is blocked

Artemis's connected development store is a different Shopify merchant, and public product HTML is not private Google Search Console evidence. No Monika merchant has approved a change, authorized Google read access, or verified an exact HTTPS Search Console URL-prefix property for this study. **Do not access Google account data, modify a public store, assume approval, or claim traffic improvement.**

The existing app's GSC OAuth flow is merchant-scoped and read-only. It should not be repurposed to impersonate the Monika storefront or import public reports into an unrelated tenant.

## Proposed randomized delayed-control design (not executed)

The revised prospective plan, `MONIKA-BLUNDER-GSC-IMPACT-PLAN-2026-11-02-v2.json`, preserves the **same reproducible, SHA-256-ordered 3/3 allocation** of the six previously identified, long-description products. The earlier `MONIKA-BLUNDER-GSC-IMPACT-PLAN-2026-11-02.json` is retained as the unmodified v1 archive. Version 2 strengthens predeclared falsification checks **before any authorized experiment or private GSC measurements exist**:

| Proposed treatment (only after merchant approval) | Proposed delayed control (unchanged initially) |
|---|---|
| Flawless Finish Essentials Kit | Melt Down Cleansing Balm |
| Sweet Talk Lip Oil | Point Taken Pencil Sharpener |
| Skincare Essentials | Architect Eyes Buildable Mascara |

All six products would remain unchanged until an authorized merchant approves the study and checks that proposed descriptions are accurate. Three would receive approved changes; three would be delayed controls for the first observation window, then could receive independent review. The fixed split guards against choosing winners after reviewing results, **but does not ensure the small set has equal query mixes or baseline traffic**. Changes to prices, pages, schema, catalog availability, navigation, or indexing during the comparison may invalidate it.

The study uses **14 Pacific reporting days before** and **14 Pacific reporting days after**, excludes the change date, and requires at least a **three-day finalization buffer** before evaluating the last post-change day. Longer windows would be preferable for sparse traffic, but this is an initial gate. `500` impressions per arm per period is only a minimum data-quality screen, **not a statistical-power guarantee**. Version 2 also requires at least **50 impressions per product in each period**, rejects a treated-vs-control baseline pretrend diverging by over **1 percentage point**, and withholds results when baseline-page-mix standardization and pooled CTR differences show a material opposite-sign change (at least **0.2 percentage points** in each). These are conservative, explicitly chosen screening thresholds, **not** statistical tests or proof of causal identification.

## Private Search Console evidence contract

Once the merchant has approved the intervention and independently granted Search Console access to the exact `https://monikablunderbeauty.com/` URL-prefix property, collect per-day/per-page Search Analytics data through the **merchant's own authorized connection**. The offline evaluator itself does not call Google. Use six separate exact page-equality filtered queries. Their common request metadata must be:

- Search type `web`, `dataState: final`, dimensions exactly `["date","page"]`, aggregation `byPage`.
- Fixed date range from 14 days before through 14 days after the confirmed change date; include the change day in retrieval but exclude it from comparison.
- Query filter: one **page equals** the specified URL for each of six queries. No country, device, query or other filters, and no other pages. Record `pageEqualsFilters` as the sorted six URLs.
- Exhaust pagination for every page and retain the source request/completeness evidence outside the repository. The export declaration `completePagination: true` is **self-attested**; the evaluator cannot independently prove GSC export completeness.
- Convert each real response row to `{"keys": ["YYYY-MM-DD", "https://.../products/..."], "clicks": integer, "impressions": integer}`. Do not fabricate zero rows for days Google omits.

Authorized offline input structure (values are **field descriptions**, not real data):

```json
{
  "studyId": "monika-public-metadata-20261102-v2",
  "authorization": {
    "merchantConsented": false,
    "propertyVerified": false,
    "permissionLevel": "siteOwner",
    "siteUrl": "https://monikablunderbeauty.com/",
    "consentedAt": "ISO8601 time (only after actual consent)"
  },
  "changeLog": {
    "merchantApproved": false,
    "changesApplied": false,
    "controlUnchanged": true,
    "changedAt": "ISO8601 timestamp of real approved change",
    "treatmentUrls": ["exact three pre-registered treatment URLs"],
    "controlUrls": ["exact three pre-registered control URLs"]
  },
  "export": {
    "siteUrl": "https://monikablunderbeauty.com/",
    "searchType": "web",
    "dataState": "final",
    "responseAggregationType": "byPage",
    "dimensions": ["date", "page"],
    "pageEqualsFilters": ["all six URLs in sorted order"],
    "completePagination": false,
    "noAdditionalFilters": true,
    "startDate": "pre-period start",
    "endDate": "post-period end",
    "exportedAt": "ISO8601 extraction timestamp",
    "rows": []
  }
}
```

Those false booleans accurately represent **today's** status; they should only change after real merchant actions. Never use an invented timestamp, approval or GSC row to unlock evaluation.

### Run offline

```bash
python scripts/gsc-metadata-impact-gate.py
python scripts/gsc-metadata-impact-gate.py --evaluate path/to/authorized-private.gsc-private.json
python -m unittest discover -s tests -p 'test_merchant_gsc_metadata_impact.py' -v
```

Never commit GSC exports, shopper data, access tokens or authorization statements. The `.gitignore` excludes `*.gsc-private.json` and `gsc-evidence-private/`.

## Output interpretation and rejection criteria

If permission, actual approved changes, control stability, finalized dates, or complete page/day coverage are missing, if an arm has fewer than 500 impressions in either period, if a product has fewer than 50 impressions in either period, or if the baseline pretrend or page-mix reversals trip their declared screens, the evaluator **withholds all effect numbers**. Missing dates are not imputed as zero.

If every gate passes, the tool computes only a **descriptive percentage-point change in CTR differences**:

`D = (CTR_treatment,after - CTR_treatment,before) - (CTR_control,after - CTR_control,before)`

It also reports the treated-vs-control pretrend difference across the two seven-day halves of the baseline window and the **fixed-baseline-page-mix CTR contrast** for sensitivity. The latter holds each arm's relative pre-period product-impression weights fixed while comparing within-product pre/post CTR. If a product gains impressions at the expense of another, the pooled CTR can change without any true within-product improvement. Material opposite-sign effects are rejected as `exposure_mix_sign_reversal`. A pretrend divergence over 1 percentage point is rejected as `unstable_pre_intervention_trend`. A nonzero result is **not causal proof**: page/query composition, rankings, device mix, SERP changes, promotions and the small 3/3 design remain confounders. The estimator does not calculate a valid statistical significance test or attributable revenue. If pretrends diverge materially, or exposure is too sparse to resolve meaningful effects, the next test should be a longer or higher-powered merchant-approved study rather than a performance claim.

The Google API can omit queries for privacy and is bounded to top rows; using page/day aggregates avoids exposing query strings, but cannot eliminate query-mix selection bias. Google normally reports finalized data after roughly 2–3 days. See [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [Getting your performance data](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data), and [Search Console data filtering](https://developers.google.com/search/blog/2022/10/performance-data-deep-dive).

**Current defensible conclusion:** Six editor-reviewed hypotheses are available. No merchant has changed anything and no search-performance result is measurable.
