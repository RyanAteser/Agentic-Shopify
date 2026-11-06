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

## First live preregistered pair: incomplete (November 6, 2026)

Case: null_urls_are_not_depublication. Single-agent case cmw5hd2ml0000uzhkapclxm1v completed 1/1 Gemini request, 594 input tokens and 203 output/thinking tokens. The model's first-line classification was **ANSWER: NO**, matching the oracle.

The paired swarm case cmw5hd2my0005uzhkmzf7xeze committed 5/6 requests and produced five stage messages, each also classified **NO** with the correct 13 active-published vs zero URL observations. The sixth requested skeptic verdict was claimed but not committed; error category WORKER_OUTPUT_OR_PERSISTENCE_FAILURE, so whether it was a provider structured-output violation or persistence rejection cannot be recovered. The swarm case was PAUSED and the sixth attempt is marked UNCERTAIN. Recorded committed usage in the five stages: 4,589 input tokens + 1,350 output/thinking tokens; final unknown attempt not included in reported totals. No replay is allowed.

**No valid paired comparison outcome exists for case 1**. It is descriptive evidence that the single specialist and five earlier swarm stages agreed, not a scored six-call swarm success. The cumulative monthly development-store budget became 14 of 25 attempts (7 prior, 1 baseline, 6 swarm); 11 remain available. No case 2 model calls occurred in this run.

Follow-up correction on a new stacked commit: add explicit Gemini responseJsonSchema (previously only application/json MIME) with mandatory text/evidenceUrls/falsifier fields and a mandatory skeptic verdict; classify provider structured-schema failure separately from persistence or worker-policy failure; update mock tests. This change is prospective, does not fix or replay the failed sixth call. Google officially documents output schemas for generateContent: https://ai.google.dev/api/generate-content .

One remaining preregistered case can be run in a **separate** owner-authorized 7-call bounded invocation, if local validation and GitHub CI pass. It is the Google indexing evidence task with an oracle of INSUFFICIENT, and is never a retry of the failed case. A successful result would provide at most one completed pair, still far too little to establish swarm advantage.
