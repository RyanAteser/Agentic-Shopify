# AI generation output budgets and incomplete-result policy

**Reviewed 2026-10-29. Development-only; no live merchant generation or billing was tested.**

## Problem and bounded fix

The inactive blog-writer n8n workflow makes **two** paid Chat Completions requests: one draft and one editorial revision. Neither previously specified an output-token cap. Both now explicitly set `max_completion_tokens: 3000`, `n` remains omitted (one choice), and the downstream Code nodes require `choices[0].finish_reason === "stop"` before accepting generated content.

An API response ending with `length`, `content_filter`, `tool_calls`, or a missing reason is **not** a complete editorial result, even if its JSON happens to parse. Such responses fail the n8n workflow rather than creating an article draft that a merchant could mistake for finished work. The existing app-side HTML sanitizer, human editorial review, and explicit Shopify publication gate still apply.

The two caps provide an upper bound of **6,000 generated completion tokens per two-stage workflow execution**, assuming one successful call per stage and no retries. This is *not* a total-token or dollar cap: input tokens, provider-side overhead, possible retries, other workflows, and the execution infrastructure also consume resources. The OpenAI API reference defines `max_completion_tokens` as an upper bound that includes visible output and reasoning tokens. A 3,000-token cap is an initial operational heuristic, **not** a measured optimum for merchant content.

## Tradeoffs and reconciliation

- Long or complex articles may terminate with `finish_reason: "length"` and be rejected. Never silently publish a shortened article. Measure rejection rates and editor acceptance on authorized, representative briefs before changing the cap.
- The writer acknowledges the job with HTTP 202 *before* calling the model. A model failure after acknowledgment may leave the app job in `running` with a reserved generation credit. This change does **not** automatically retry, refund, or claim exactly-once completion. The operator must inspect n8n execution evidence and reconcile the job; see [outbox recovery](OUTBOX-RECOVERY.md).
- No retry-on-fail behavior is introduced. If retries are enabled later, account for every paid attempt in the budget and prevent duplicate article callbacks.
- This does not enforce a merchant-level spend ceiling, rate limits, provider budget alerts, tenant quotas beyond existing free-credit rules, or a maximum **input** token count. Production activation requires those independent controls and measured costs.
- Existing workflow execution persistence may store generated content and merchant context; follow [n8n execution retention](N8N-EXECUTION-DATA.md) and validate pruning in staging.
- The workflow uses `gpt-4.1-mini`; review model availability and deprecation notices before release. Model migration requires output-quality and cost regression tests.

## Validation and launch gates

1. Static workflow regression tests evaluate both JSON request expressions and both parser Code nodes against `stop`, `length`, `content_filter`, `tool_calls`, and missing finish reasons.
2. On an authorized **inactive staging** n8n instance, exercise representative synthetic briefs, deliberately truncated responses, timeout behavior and execution-history cleanup.
3. With merchant consent, collect **aggregated** per-stage input/output tokens, failure reason, latency, and human acceptance without storing prompts or article bodies in analytics. Report medians and tails by merchant cohort without revealing another tenant's information.
4. Define an operator reconciliation SLA for post-202 failures before enabling scheduling. Do not charge or consume extra credits on an automatic retry.
5. Verify a separate provider-side monthly spend limit and alerting, plus merchant-level concurrency/rate budgets. Never enable billing or live publishing as part of this experiment.

**Impact hypothesis:** bounded generation costs and fewer incomplete drafts reaching human review should improve predictable unit economics and merchant trust. No actual savings, retention, conversion, traffic or revenue lift has been measured.

Primary references: [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [OpenAI response length guidance](https://help.openai.com/en/articles/5072518-controlling-the-length-of-openai-model-responses), [n8n retry documentation](https://docs.n8n.io/integrations/builtin/handle-rate-limits/).
