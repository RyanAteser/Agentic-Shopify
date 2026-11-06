# Real merchant evidence intake and independent-review preparation

**November 6, 2026. Draft research addition, stacked on PR #17.**

## Scope and result

This adds a **real-source, read-only collection path**, separate from the 30 synthetic adversarial scenarios. It does not fabricate consent, human adjudication, Google Search Console indexing, Google billing data, or merchant performance outcomes.

On November 6, a fresh **authenticated Artemis Shopify Admin GraphQL 2026-10** snapshot was successfully collected:
- 18 sampled products, 16 ACTIVE, 13 ACTIVE products in the published sample.
- 0 published products with a non-null onlineStoreUrl.
- Storefront password protection enabled.
- Source digest: `804d76565d596d939f38b7b10e8b4b0132fe7532e3e5e40f56225af76368206a`.
- Capture ID: `e569bff9-bde3-4054-98a9-34055f2e3961`.
- Five factual questions created from **one observed merchant snapshot**. These observations are correlated, **not five independent merchants**.
- **0** human reviewer answers, **0** model calls, **0** Shopify writes, and no additional monthly model-credit consumption.

Artemis was repeatedly observed earlier in development, so the source is explicitly tagged `calibration_seen_development_store`, **excluded from the held-out evaluation denominator**.

## Local files

Local owner-only directory:

`%LOCALAPPDATA%\AgenticShopify\Evaluations\RealEvidenceIntake\`

- `artemis-calibration-first-observation.json`: private authenticated-source capture, shop domain, source digest, date, five bounded evidence items, and consent note.
- `artemis-calibration-blind-review-packet.json`: pseudonymized collection of the five questions, identical bounded source counts and source digest. Omits shop domain, credentials, product titles, customer data, and answer keys.
- `cohort-merchant-pseudonym-salt.local`: private per-owner random salt used to pseudonymize merchant identities across multiple captures. Never commit, email or place in a reviewer packet.
- `ReviewerPackets\reviewer-A-blind-packet.json` and `reviewer-B-blind-packet.json`: separate copies for independent adjudicators.
- `ReviewerPackets\reviewer-A-submission.json` and `reviewer-B-submission.json`: **blank** submissions; reviewers must independently fill their own ID, attestation, each YES/NO/INSUFFICIENT label, a decision on whether skeptic escalation was needed, and source-supported reasoning. Do not fill these with LLM-generated labels.

Commands (local terminal, **read-only / offline review**):

```powershell
cd D:\AgenticShopify-Swarm-Lab
node --import tsx scripts/capture-swarm-real-observation.mts --artemis-calibration-readonly
node --import tsx scripts/prepare-swarm-human-review.mts --prepare-calibration-reviewers
node --import tsx scripts/prepare-swarm-human-review.mts --calibration-review-status
```

The capture and packet preparation deliberately use **exclusive create**, not overwrite. A repeat capture returns the previously captured ID without making another Shopify request. Repeated reviewer-packet preparation refuses to overwrite submissions.

## Recruiting genuinely new merchants

The manual script `scripts/capture-swarm-consented-merchant.mts` supports an **already installed, separately consenting Shopify merchant**. It does **not** install the app, request new OAuth scopes, or grant authorizations. It uses only a currently valid, matching offline `read_products` session, the existing same-shop Shopify Admin snapshot collector, and an explicit local consent record stored under `RealEvidenceIntake\Consents`.

Sample future consent file, supplied by the merchant/operator (example only, no actual approval):

```json
{
  "shop": "example-consenting-merchant.myshopify.com",
  "approvedScope": "read_products",
  "approvedPurpose": "bounded_storefront_seo_evidence_evaluation",
  "approvedData": "aggregate_product_publication_password_url_counts_only",
  "consentEvidenceReference": "ownerrecord_example_20261106",
  "consentCapturedAt": "2026-11-06T23:00:00.000Z",
  "authorizedMerchantRepresented": true,
  "independentIdentityVerification": "pending_external_verification"
}
```

Usage after a real consent exists:

```powershell
node --import tsx scripts/capture-swarm-consented-merchant.mts --consent-file "$env:LOCALAPPDATA\AgenticShopify\Evaluations\RealEvidenceIntake\Consents\merchant-approval.json"
```

The signer and merchant's authority remain **unverified by the offline tool** even if the form says they consented. A genuinely independent study requires separate identity/consent verification, authorizations, privacy procedures, and human review. The tool therefore calls these records `holdout_candidate_unverified`, never certified independent held-out cases.

Previously observed `artemisti.myshopify.com` and `monikablunderbeauty-com.myshopify.com` cannot be admitted as new held-out merchants by this intake. No such new merchant consent was supplied or used in this task.

## Review integrity and data quality gates

- Two **different actual humans** must review the same anonymized snapshot/question independently and submit complete five-question source-backed judgments. Their IDs, data references and attestations are checked; the code does **not** authenticate their real identities. Reviewer integrity must be established outside the local tool.
- Disagreeing reviews are recorded as **disputed**, not silently resolved or counted as unanimous.
- Replayed case IDs, wrong digest, cross-store source references, stale consent and invalid snapshot shape all fail closed.
- Reports distinguish the number of **observed questions**, **distinct source snapshots**, and **distinct merchant pseudonym groups**. Multiple questions or days from one merchant cannot be described as multiple independent merchants.
- A reviewed evidence packet is still not a paired single-agent versus adaptive-skeptic experiment. New independent model receipts, a separate capped owner-approved execution budget, and verified Google billing are outstanding.
- No automatic Shopify publishing, content, product, pricing, inventory, customer, or subscription billing mutations.
- Both intake scripts and reviewer tools run entirely outside the live merchant production deployment. Only local owner research files are written.

## Current readout and remaining gate

| Measure | Captured |
| --- | ---: |
| Authenticated merchant groups | 1 (calibration only) |
| Verified source snapshots | 1 |
| Observed factual questions | 5 |
| Eligible new held-out merchant groups | 0 |
| Human reviewers completed | 0 |
| Independent paired model evaluations | 0 |
| Artemis Gemini request attempts spent this work | 0 |
| Artemis remaining local monthly attempt credits | 4 |
| Subscriber rollout authorized | No |

**Next highest-information step:** obtain independently verifiable opt-in from additional merchants, collect snapshots with the same read-only scope, recruit blinded human reviewers, then evaluate a preregistered subset only within a newly approved provider budget. Do not count these Artemis calibration observations as fresh holdout validation, and do not infer merchant SEO uplift from administrative metadata.
