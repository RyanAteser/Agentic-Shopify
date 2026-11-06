# 30-scenario Shopify swarm evaluation, engineering stress phase
November 6, 2026. Draft-only branch stacked on PR #16. No live-model execution in this phase.

## What was frozen

- **30 distinct scripted scenarios**, six categories with five items each: password, channel publication, product URL counts, partial samples, external outcomes requiring GSC/analytics, and proposed merchant actions.
- Manifest SHA-256: `d6bd3f60d33dd587dc4416f6674f036fdcf83978576fa3d0dc71f42fe67ef3c1`.
- Each scenario has an explicit question, synthetic counterfactual Shopify Admin snapshot, scripted candidate model response, code-authored expected answer, escalation obligation, and basis. The tests assert manifest stability.
- Counterfactual snapshots resemble the verified Artemis baseline fields, but many values are intentionally perturbed. **These are not 30 independent stores, 30 authentic Google indexing observations, or independently adjudicated merchant outcomes.**
- Scripted candidate outputs are **not live Gemini model responses**. Two responses deliberately supply wrong labels.

## The failure and correction

Original adaptive route accepted any correct `sourceFact` field/value as sufficient factual evidence for early exit. In scenario P05 the scripted specialist asserted the **wrong YES/NO answer** while citing a **true** Shopify password-protection field. The original policy missed escalation: **one critical safety miss** out of 30.

The correction adds `trustedQuestionTruth`, an independent, versioned, deterministic truth check for **exactly matched, reviewed, narrow Shopify factual questions**. General user-written questions default to skeptic escalation, even if the model quotes a genuine field. Only when (a) the exact question is supported, (b) the machine check has a decisive YES/NO answer, (c) the model's answer agrees, (d) the matching source field/value is corroborated, and (e) all risk gates pass can the case stop after one model call. The status remains **needs_evidence**, not merchant-approved.

After correction, the scripted stress suite reports:
- 30/30 scenarios evaluated by the offline router.
- **0 missed escalation triggers**, including 0 critical misses.
- **9/30 unnecessary escalations**, a real cost/efficiency weakness to study.
- Scripted first-pass answer labels: 28/30 correct, **not model accuracy**; answers were intentionally authored fixture responses.
- 0 model requests, 0 Shopify writes, 0 human review judgments in this phase.

The fixed manifest was *used during engineering refinement*. Therefore this is **in-sample safety regression**, not a blind held-out validation set, even though the fixture IDs were created before the final strict rule. A genuinely held-out set must be created separately, with sealed oracle labels and no tuning after exposure.

## True blind review and paired-model scoring

`scripts/evaluate-swarm-30.mts` is deliberately **OFFLINE ONLY** and imports no model provider, worker or Shopify connector:

- `node --import tsx scripts/evaluate-swarm-30.mts --offline` audits scripted escalation and writes a local safety report.
- `node --import tsx scripts/evaluate-swarm-30.mts --packet` exports the scenario inputs without oracle labels or scripted responses, to `%LOCALAPPDATA%\AgenticShopify\Evaluations\swarm-eval-30-blind-packet-v1.json`.
- `node --import tsx scripts/evaluate-swarm-30.mts --score <local-review-and-run-receipts.json>` accepts separately collected one-call and adaptive-run receipts (one unique execution per arm per case) plus **two distinct, agreeing reviewer judgments per case**, rejects malformed and duplicate records, and reports only complete paired outcomes. Missing/contradictory reviews are not graded.

The scorer reports paired exact-label accuracy, missed required skeptic escalations, unnecessary reviews, claim/request completion, and provider-reported token-price estimates. It **never invents Google invoices**: `actualGoogleInvoiceUsd` remains null without an authenticated billing connector. Even user-attested invoice JSON is displayed only as an unverified period-total claim, not request-level spend. Published Gemini 3.8 Flash paid-tier example rates are $0.75/M input and $3.75/M output+thinking through December 31, 2026 (https://ai.google.dev/gemini-api/docs/pricing). Pricing or plan may change, and free-tier billings may be zero. Actual usage charges need the Google AI Studio Usage / Billing export and reconciliation (https://ai.google.dev/gemini-api/docs/billing).

Even 0/30 missed triggers would leave a Wilson 95% upper confidence bound around 11.4% on the miss rate, before correlated cases and synthetic-data bias. This evaluation cannot approve a merchant subscription rollout. The scorer always refuses subscriber launch.

## Budget and current deployment constraints

- Artemis developer-store monthly attempt ledger previously **21 of 25 consumed**, 0 reserved, leaving **4**.
- The 30-case paired live comparison requires at least 30 single-agent calls plus up to 90 adaptive calls, significantly exceeding the remaining 4 allowed attempts. Do **not** increase or evade the cap to force a result.
- The local report and reviewer packet are written outside Git, and contain no API key, merchant private content, customer information or model transcript.
- No Google Billing project or invoice was connected. **Actual billed cost is unavailable.**
- The Monika Blunder Beauty read-only pilot remains unchanged. PRs #13, #14, #15, #16 and this branch are draft and not on main.

## Rejection and next independent test

Do not call adaptive skepticism commercially useful until:
1. Collect 30+ genuinely new **independently labeled** merchant problems from diverse source snapshots without reusing these fixtures as the held-out sample.
2. Blindly run the same model with identical factual snapshots through single and adaptive arms with distinct persisted execution receipts, under an independently approved testing budget. Stop on uncertain calls and do not replay.
3. Require no critical missed skeptic triggers, improved quality-adjusted factual accuracy versus one model, acceptable abstention/false-positive rates, reliable completion, and reconciled actual vendor billing.
4. Show a larger independent replication: 0/30 safety misses cannot establish the desired low miss probability, especially across a single store and similar cases.

The highest-information next step is to acquire actual independently adjudicated merchant questions and a billing export, then run a preregistered comparison on a *new*, not previously optimized, holdout.
