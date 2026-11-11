# Merchant contribution margin lab (draft, 2026-11-10)

**Status: owner-only, read-only finance research on a stacked feature branch.** No Shopify billing is activated, no paid provider request is made, no merchant data is changed, and this does **not** show real profit. It computes modeled monthly contribution from persisted usage observations plus explicitly supplied price and overhead assumptions.

## Why the earlier $35 / $105 / $257 figures need verification

Earlier forecasts assumed rough allowances that were not reconciled against Google, OpenAI, Bright Data, n8n, Shopify, hosting or support invoices. Licensing, support time and unmetered Blog Agent generations are major uncertainty sources. CAC, corporate overhead, taxes, and salaries were excluded.

This lab refuses a numeric *modeled* contribution if a committed model call lacks an exact price card, an uncertain call lacks a billing reserve, or unmetered Blog Agent work lacks a per-job cost allowance. Even a complete estimate is **not actual net profit** until invoices and Shopify payouts reconcile.

## Read-only monthly measurement

From the authorized operator development shell:

~~~sh
node --import tsx scripts/report-unit-economics.mts \
 --shop consenting-merchant.myshopify.com --month 2026-11
~~~

Only same-shop UTC-month rows are read: model invocation attempts and status, provider-reported tokens and exact model, blog jobs and drafts, publications, editorial review minutes, and ingested SERP snapshots.

To apply **hypothetical** cost allowances:

~~~sh
node --import tsx scripts/report-unit-economics.mts \
 --shop consenting-merchant.myshopify.com --month 2026-11 \
 --assumptions docs/profit-scenario.example.json
~~~

The example input uses a published Gemini 2.5 Flash-Lite model token price as a *rate-card assumption*, not as evidence that the merchant used this model or received an invoice. Other model versions remain unpriced unless explicitly configured. No secrets or vendor invoice data should be committed.

The three reported plan prices ($49, $149 and $399) are **counterfactual revenue prices on the SAME observed merchant workload**, not separately measured plan cohorts. Heavy-usage modeling will require per-tier workload distributions from an authorized pilot.

### Formula

- Gross plan subscription
- Minus Shopify processing rate and conditional developer revenue share (both supplied explicitly).
- Minus exact-model quoted price for committed reported tokens.
- Minus uncertain model-call reserve times the count of uncertain attempts.
- Minus Blog Agent allowance times generation jobs (tokens not yet measured by n8n).
- Minus assumptions for external SERP research, infrastructure, support and allocated commercial workflow license.

**The result excludes** CAC, refunds, chargebacks, taxes, salaries, legal, fixed business overhead and variability of actual invoices. An ambiguous provider POST is **not free**. Snapshot counts do not automatically equal chargeable SERP requests.

The example license allocation of $0 is deliberately an **unknown placeholder**, not proof that n8n Enterprise/OEM costs $0.

## Source references

- Shopify revenue share / processing: https://shopify.dev/docs/apps/launch/distribution/revenue-share
- Google Gemini API text token pricing: https://ai.google.dev/gemini-api/docs/pricing
- n8n commercial/OEM terms: https://n8n.io/oem/

## Production accounting requirements, not yet satisfied

1. Record provider-signed or reconciled receipt fields for Blog writer/editor tokens, retries and model usage. Record immutable price-card versions for each billed call.
2. Implement authorized, idempotent tenant-scoped vendor invoice import for Bright Data, n8n, image generation and workflow services.
3. Enforce per-tenant spend ceilings BEFORE dispatch, including uncertain delivery handling. No blind automatic replay.
4. Reconcile Shopify actual subscription payouts, refunds, developer revenue-share eligibility and regulatory fees.
5. Allocate real licensing, infrastructure, support labor, customer acquisition and retention costs by merchant and plan.
6. Validate the merchant benefit: accepted recommendations, human labor, measured qualified traffic, conversions and attributable revenue.
7. Stress-test each plan at high usage/support volume and reject plans with negative contribution.

This feature adds no HTTP cost reporting route, Shopify write, billing entitlement, provider call or merchant-facing financial claim.


## 70% target contribution margin: maximum service expense per merchant

Assuming an eligible 0% Shopify revenue share and a 2.9% processing fee, the **entire** allowance for model tokens, external data, workflow software, infrastructure, support, and unmetered retries is:

| Proposed tier | Subscription | Maximum service expense at 70% contribution |
| --- | ---: | ---: |
| Starter | $49 | **$13.27 / month** |
| Growth | $149 | **$40.37 / month** |
| Operator | $399 | **$108.12 / month** |

If Shopify's developer revenue share were 15%, those limits would instead be **$5.92, $18.02 and $48.27**. These are arithmetic pricing constraints, NOT observed business costs. The eligible revenue-share tier is not assumed for an actual merchant without Shopify verification. Every subscription plan must enforce its own worst-case spend and support limits.

The example assumptions file uses $0 allocated workflow license even though commercial licensing is unresolved. Therefore the example must not be interpreted as a launch-ready contribution claim. Actual invoices and subscription payouts determine realized results.


## Blog Agent token receipt integration (Nov 10)

The job-scoped article completion callback now carries up to two optional OpenAI token usage records, one from the writer and one from the editor. The inactive n8n workflow reads Chat Completions model identity, prompt tokens, completion tokens, and response ID. Only bounded token counts, model names and a SHA-256 digest of the response ID are stored, not prompts or API keys.

The existing per-job HMAC callback capability authenticates shop/job identity. Usage validation, deduplication by stage, and article completion happen in one tenant-serialized transaction. Completed jobs cannot acquire or replace receipts from replayed callbacks. The shared merchant privacy deletion removes these records.

The read-only finance report joins token receipts to their original job-creation UTC month, including later arrivals. When both stages have bounded token observations, an explicit model/version price card supplies a cost quote. A job missing one or both stages retains the FULL assumed unmetered-job allowance, alongside any observed stage, deliberately conservative. If the cost allowance is zero, it refuses a numeric contribution estimate.

Worker-reported tokens are NOT provider invoices. Incomplete callbacks, cached-token discounts, response timeouts, batch discounts, regional charges, hidden vendor fees and subscription payouts still require reconciliation. Official OpenAI GPT-4.1 mini public price card: https://developers.openai.com/api/docs/models/gpt-4.1-mini .

The workflows remain inactive; no merchant billing or model request was initiated by this change.

Still required: live n8n staging run, provider invoice matching, externally measured SEO data charges, per-tenant dollar budgets, and subscription payout reconciliation.
