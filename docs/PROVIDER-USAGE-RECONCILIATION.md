# Provider usage cross-check, operator only

**Status: draft, read-only, not invoice reconciliation or actual merchant profit.**

This audit addresses a narrow evidence gap: n8n worker-reported usage does not establish that the provider processed a specific request. Conversely, a provider can process a request after an article callback fails.

The Blog Agent stores a purpose-separated SHA-256 hash of the OpenAI response ID when available. This tool hashes the raw response IDs in an **operator-supplied local export**, then compares hashes, exact model names and token counts. Raw IDs are not written to the application database or included in report output.

## Input format

The provider input format is a **custom normalized JSON interchange**, not an assertion that OpenAI's dashboard exports this exact structure. An operator must transform genuinely available evidence into this schema, without inventing identifiers or tokens.

Example synthetic provider-usage.json:

```json
{
  "schemaVersion": 1,
  "provider": "openai-chat-completions",
  "period": "2026-11",
  "accountScope": "shared",
  "exportDescription": "Synthetic, not a vendor-authenticated export",
  "records": [
    {"responseId":"chatcmpl_example_writer_001","model":"gpt-4.1-mini-2025-04-14",
     "inputTokens":1000,"outputTokens":500,"createdAt":"2026-11-10T12:00:00Z"}
  ]
}
```

The optional billing extract is an account-wide operator statement, NOT per-merchant cost:

```json
{
  "schemaVersion":1,"provider":"openai-chat-completions",
  "period":"2026-11","currency":"USD","totalBilledCents":14,
  "accountScope":"shared",
  "sourceDescription":"Synthetic account billing example, unverified"
}
```

The account scope is shared or operator_claimed_dedicated. **Neither is independent proof** of which merchant incurred a vendor charge. Leave provider-only requests unallocated in a shared account.

Run locally with operator-owned database credentials and privately held files, never in a browser:

```sh
node --import tsx scripts/reconcile-provider-usage.mts \
  --shop consenting-merchant.myshopify.com --month 2026-11 \
  --provider-export /private/provider-usage.json \
  --billing-extract /private/provider-billing.json
```

The billing extract is optional. Do not commit real vendor exports, invoice details, credentials or customer data. The command does not make API calls or write application database rows.

## Interpret the outcomes

- **Exactly matched:** stored worker digest matches a provided response ID and both model and token counts agree. This is not a verified bill.
- **Discrepant:** response ID matches, but model or token counts disagree. Treat as a reconciliation conflict.
- **Worker-only:** a worker reported usage for a request absent from the provider export. A partial export is not proof that request was free.
- **Provider-only:** request in the provider export but no matching worker report. It might be a failed writer/editor attempt or activity from another shop.
- **Unlinkable:** worker reported tokens but did not include a response ID.
- **Account-wide billed figure:** operator-supplied aggregate. It is never a per-shop charge and must not be included as merchant COGS without independent attribution.

Even if everything matches, the result remains completeness:unproven, vendorInvoiceVerified:false, merchantBilledCents:null and realizedProfitCents:null. An operator file is not vendor-authenticated accounting.

Safety checks reject duplicate request IDs, duplicate job/stage reports, foreign tenants, mismatched export/invoice periods, invalid UTC timestamps, zero or implausible tokens and unsupported schema. Raw response IDs do not appear in output.

The initial audit compares jobs created in a selected UTC month against requests in that same month. Cross-month executions require a separately documented allocation policy. No automatic backdating is allowed.

## Important failed-editor case

The real n8n engine test in PR #23 established that both model requests may execute before an incomplete editorial response prevents the final callback. The current Blog Agent usage table can therefore be missing billed work. Its budget reservation remains held, which is conservative. Provider-only requests expose this uncertainty but cannot determine actual charges.

The next engineering phase is authenticated per-stage token persistence even on failed article completion, plus independently sourced provider billing evidence. Real provider pricing, cached and batch-token discounts, refunds, shared-account attribution, licensing and Shopify subscription payouts all remain unverified.

**No live merchant workflow, paid provider request, billing change or actual-profit claim is part of this feature.**
