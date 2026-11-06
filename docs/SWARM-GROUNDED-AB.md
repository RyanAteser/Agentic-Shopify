# Grounded single-agent versus swarm A/B (2026-11-06)

Branch: feat/swarm-grounded-ab-eval-20261106, stacked on PR #14. This is a preregistered exploratory developer-store evaluation, not SEO profitability validation.

## Frozen tasks and hidden oracle
Both tasks use the same authenticated shop-bound Artemis Shopify Admin snapshot. The truth labels are computed deterministically from the snapshot and not included in the model prompts.

1. null_urls_are_not_depublication: Does every published product having a null onlineStoreUrl prove that there are zero active published products? Expected NO if publishedActiveProductsInSample > 0 while publishedProductsWithOnlineStoreUrl is zero. The observed developer store had 13 active published and zero non-null URLs.
2. google_indexing_requires_independent_evidence: Does the Shopify Admin snapshot establish whether any pages are currently indexed by Google? Expected INSUFFICIENT. Shopify Admin product/password data do not contain actual Google URL Inspection or indexing evidence.

These cases are new to this A/B protocol, but no claim is made that the model never encountered similar questions during training. Two cases cannot establish general research superiority.

## Equal evidence and asymmetric cost
Single-agent arm: one Gemini 3.8 Flash call, fixed 650 max output tokens, frozen read-only snapshot, generic evidence audit lane.
Swarm arm: six calls, same model/settings/snapshot; two independent specialists, skeptic challenge, revision, skeptic recheck, skeptic final verdict.
The first two specialists cannot view each other's output. No baseline response enters the swarm's transcript.
Both must begin the JSON text field with ANSWER: YES, ANSWER: NO, or ANSWER: INSUFFICIENT. An exact first-line label is required; no label is scored incorrect. The deterministic oracle is not sent to either arm. Separate human review remains necessary for the explanation, unsupported assertions, and URL/source provenance.

## Budget and execution controls
Owner-operated runner, development store only. No Shopify write operations, customer data, content publication, or automatic scheduling.
The shared existing 25-model-request monthly cap is authoritative. Seven request-attempt credits were previously used; two pairs need at most fourteen additional attempted calls, leaving four if all succeed.
Baseline and swarm both reserve credits, claim each model call before POST, and persist execution and token receipts. Any uncertain provider response ends the comparison, remains counted, and is never retried. The paired cases are kept separately and marked benchmark_evaluated when scored.
Report artifacts are kept outside Git in the owner's local AppData evaluation directory with aggregate labels, token counts and indicative pricing only. Provider invoices are not visible to the benchmark.

## Reporting and rejection threshold
Show both arms' exact-correct labels out of two, invalid label count, provider-reported input/output/thinking tokens, approximate paid-tier model cost and any provider failure. The November 2026 quoted illustrative rates are $0.75 per million input and $3.75 per million output/thinking tokens; these are not verified invoiced amounts.
A swarm worth launching widely must show replicated accuracy or evidence quality improvement on multiple held-out, independently scored merchant problems, not merely better wording. If both arms get both answers right, the lower-cost single-agent arm is favored on this benchmark.
This experiment cannot establish Google indexing, search rankings, traffic growth, conversion, ROI, or unique SEO alpha.
