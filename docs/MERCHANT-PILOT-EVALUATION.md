# Merchant editorial pilot: paired, offline evidence

**Status (2026-10-30):** Evaluation harness only, not a completed merchant experiment. No Shopify API, store edit, publication, billing, marketing send or new permissions.

## Why this matters

Article volume and voluntary "usable" clicks do not establish merchant value. A comparison must include rejected attempts, factual/product-link defects and human labor spent on successes **and failures**. This tool compares topic-matched manual and AI-assisted draft workflows. It does not measure rankings, conversion, revenue, retention or causality.

## Pilot protocol (before collecting outcomes)

1. Pre-register the planned sample, eligibility criteria, reviewers, and definitions of critical factual errors and incorrect/broken product links. **20 pairs is an operational-review gate, not a statistical power guarantee.**
2. For each matched merchant/topic, create manual and AI-assisted drafts. Document randomized and counterbalanced review order; avoid copying one arm's text into the other. Blind scoring where possible. The evaluator cannot independently verify randomization or blinding.
3. For **each arm**, record the merchant's usable/rejected decision, *all human labor minutes* (creation, review, corrections, including work on rejected drafts), critical factual errors and product-link errors. Model fees and machine wait time are excluded and must be accounted for separately.
4. Include every planned pair, using null for missing arm outcomes. Never remove failed, unreviewed or difficult cases. A **quality pass** requires a human usable decision, zero critical factual errors and zero product-link errors.
5. Run the offline evaluator on anonymized data. Relative labor comparison is suppressed until every planned pair is complete, at least 20 pairs exist, order is balanced and blinded scoring is attested for all pairs. Even then, results are descriptive and require independent review.

## Privacy-minimized input

Store JSON locally with opaque random pair IDs. **Never include** shop URLs, merchant or customer names, emails, order information, prompts, article bodies or product names. Unknown fields are rejected; input is limited to 1 MiB and 500 planned pairs.

Illustrative structure only (one of 20 planned pairs, deliberately insufficient to report a comparison):

```json
{
  "protocol": "paired-editorial-pilot-v1",
  "preregisteredAt": "2026-10-01T00:00:00Z",
  "startedAt": "2026-10-02T00:00:00Z",
  "plannedPairs": 20,
  "pairs": [{
    "id": "opaque_001", "order": "ai-first", "blindScored": true,
    "ai": {"decision":"usable","laborMinutes":12,"criticalFactualErrors":0,"productLinkErrors":0},
    "manual": {"decision":"rejected","laborMinutes":25,"criticalFactualErrors":1,"productLinkErrors":0}
  }]
}
```

Run locally:

```bash
node scripts/merchant-pilot-evaluate.mjs /path/to/anonymized-pilot.json
```

## Metrics and release interpretation

- **Quality pass rate**: quality-passing attempts / all completed paired attempts in an arm.
- **Human labor minutes per quality pass**: all human labor minutes, including rejected attempts, / quality-passing outputs. Null when none pass. This is a descriptive throughput proxy, **not time saved**.
- **Relative labor per quality pass**: 100 × (AI minutes per pass / manual minutes per pass − 1), shown only when operational gates pass. A negative number favors AI, but cannot establish a causal or statistically significant effect.
- **Paired quality discordance**: both pass, AI only passes, manual only passes, neither passes. A tied aggregate pass rate can still conceal different failing topics.
- **Quality pass rate difference**: AI minus manual in percentage points, suppressed until the same operational gates pass.
- **Conservative decision support**: `insufficient-evidence` for incomplete/unblinded/imbalanced pilots; `quality-review-required` if AI has any critical factual or product-link error or fewer quality passes than manual; `cannot-compare-efficiency` if neither arm has a passing output; `no-observed-efficiency-gain` if AI labor per pass is not lower; otherwise `candidate-for-independent-review`. **Even candidate status does not authorize publishing, launch, billing, or a claim of improvement.**
- **Incomplete pairs**: includes missing arms and unrecorded planned pairs. They are never silently counted as successes. Registration and blinding flags are self-attestations, not verification.

Pre-register an actual merchant decision rule: quality pass rate no worse than manual, fewer human labor minutes per pass after all failures, and no unacceptable critical factual or product-link errors. Review uncertainty, reviewer disagreement, costs, merchant mix and subscription economics before claiming benefit. Do not publish or charge based on the offline result.

## Limitations and next step

The per-arm summaries use only completed pairs, and incomplete planned pairs block comparative metrics. A negative relative labor ratio can coexist with serious quality regressions, so decision support checks quality first. The zero-error AI threshold is deliberately conservative for triage, not a calibrated non-inferiority margin. The tool cannot establish whether recorded review order was randomized, or independently verify merchant assessments.

Paired evaluations can suffer from carryover, reviewer learning, order effects, and correlated samples from the same merchant. No p-values, confidence intervals, causal inference or real merchant outcome data are produced. Existing app review-minute reports do **not** include manual creation baselines. Collect separately consented, blinded pilot observations before making a claim. Later study qualified Search Console traffic and Shopify conversions with a separate, appropriately designed longitudinal analysis.

References:
- Google Search Central, people-first content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Shopify, content marketing strategy: https://help.shopify.com/en/manual/promoting-marketing/content-marketing
- Shopify, marketing attribution: https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/marketing-reports
- Wharton, 2,732 e-commerce A/B tests: https://mackinstitute.wharton.upenn.edu/2020/empirical-meta-analysis-e-commerce-a-b-testing-practices/
- E-commerce A/B testing and p-hacking (2025): https://pubsonline.informs.org/doi/abs/10.1287/isre.2024.0872
