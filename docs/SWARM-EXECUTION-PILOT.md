# Bounded swarm execution pilot

Status: implemented in the stacked feature branch, NOT deployed. No live model calls performed. Operator API keys were not found, and no merchant charges or Shopify mutations were initiated.

## Worker graph

An eligible case must have exactly two same-role specialists and one independent skeptic. Six bounded model requests run sequentially: (1) Specialist A hypothesis, (2) Specialist B independent evidence pass blind to A's output, (3) skeptic challenge, (4) Specialist A revision, (5) skeptic recheck of revised round, and (6) final skeptic verdict. Each has a distinct persistent research lane. All earlier messages are tenant-scoped, and the initial independent passes cannot see one another.

The model is untrusted. Model-reported citations and metrics are not independently verified. A self-approved supported verdict is converted to abstain, leaving the case at needs_evidence. A rejected claim may stop earlier. No worker can publish, change products or access Shopify tools.

## Request and credit accounting

- Strict monthly free pilot budget: 25 model-request attempts per shop. No paid entitlement or real subscription is enabled.
- Before any provider POST, reserve six attempt credits in a merchant-locked database transaction.
- Each started attempt atomically changes one reserved credit to consumed and creates a unique invocation record.
- Unknown provider outcomes remain consumed and uncertain. No automatic retry.
- Unused reservations are released after completion or manual reconciliation. A crashed/abandoned lease is never replayed.
- Token counts from the provider and a SHA-256 digest of output are stored, but no validated USD pricing is reported.
- One active execution per shop. One execution attempt per case. Agent IDs are frozen at queue time.
- Current non-USD attempt credits are protective infrastructure counters, not an invoicing system.

## Operator-only command (not an app endpoint)

Prerequisites: the authorized Shopify development store must already have a session, StoreConfig, and queued case with two specialists and one skeptic. The separate read-only Monika pilot is forbidden. Set all these process-level flags through a secure secret store:

- SWARM_WORKER_ENABLED=true
- SWARM_EXECUTION_ENABLED=true
- SWARM_ENABLE_PAID_MODEL_CALLS=true
- SWARM_WORKER_ALLOWED_SHOP=<exact dev-store .myshopify.com host>
- SWARM_GEMINI_MODEL=gemini-3.8-flash (or supported gemini-2.5-flash-lite)
- GEMINI_API_KEY=<server secret, never checked into Git>

One-time run: node --import tsx scripts/run-swarm-bounded.mts --case <case-id>

After a lease has expired, to reconcile without replay: node --import tsx scripts/run-swarm-bounded.mts --reconcile <execution-id>

No process starts automatically. No API key is in the branch. The script does not load dotenv secrets automatically. Explicitly review real vendor charges before activating. CLI output is only status, token counts and non-sensitive identifiers.

## Gemini adapter constraints

Fixed Google Gemini GenerateContent endpoint, explicit model allowlist, structured JSON output, no retries, no model tools, 20-second per-request timeout, 650 output-token ceiling, 9,500 input-character ceiling and 64 KiB HTTP response bound. Provider reports include input, output and any thinking tokens. Unknown provider bills are not estimated or refunded automatically. A user-supplied URL is never fetched.

## Tests and launch gates

- SQLite end-to-end synthetic-model test for the 6 stages, independent first pass, forced skeptic abstention, token and credit ledger and uninstall redaction.
- Failure injection with ambiguous third call, one attempted credit consumed, no model retry and unused reservations released.
- Wrong-tenant, disabled operator, read-only pilot and budget-overflow refusals.
- Explicit expired-lease reconciliation never calls the model.
- Fixed-endpoint Gemini transport simulation: structured output, no retry, reported token accounting and bounded response.
- PostgreSQL concurrent reservations must not exceed free pilot budget.
- Full test suite, TS checks, PostgreSQL migration and Docker smoke must pass in GitHub Actions.

Outstanding: real provider credential integration and dev-store live smoke, verified Shopify App Pricing billing state, accurate per-token/provider tariffs and actual USD costs, cryptographically authenticated remote worker claim API, provider/source timestamp evidence receipts, real analytics baseline, controlled holdouts and reproducible proof of incremental business lift. The next empirical comparison should be a grounded dev-store test against a single-agent control, not a 50-agent production launch.

## First owner-approved development attempt (November 6, 2026)

- The uploaded Gemini auth key was transferred to the owner's Windows machine, protected with user-scoped DPAPI outside Git and its plaintext staging file deleted. The Google Gemini model metadata GET returned HTTP 200 and supported GenerateContent, but **this does not prove POST authorization**. Because the key appeared in the chat, rotate it before production.
- Artemis dev shop `artemisti.myshopify.com` established one valid read-only-capable offline session. One queued case `cmw5flbj00003uz74ttikzr0j` had two SEO specialists plus one independent skeptic. Owner authorized local one-shot execution from a PowerShell launcher outside Git.
- Result: **`blocked_uncertain`** on the **first attempted model call**. Zero provider results were committed; the three original brief messages remain. The case was paused. Monthly ledger: **one request-attempt credit consumed**, zero reserved; all five unattempted credits released. The existing case is permanently non-replayable. No Shopify writes and no research conclusion occurred.
- The original adapter swallowed all provider error details, so the failure's precise cause is **not recoverable** from this attempt. It may be an HTTP response rejection, truncated Gemini reasoning/output, malformed JSON, or transport/persistence failure. No billable-token count was returned; this does not establish zero vendor charge. **Do not replay this call.**
- Follow-up hardening (no additional live model requests): persist a bounded safe error category such as `GEMINI_HTTP_403`, `GEMINI_FINISH_MAX_TOKENS`, `GEMINI_INVALID_JSON`, or `GEMINI_TRANSPORT_UNCERTAIN` on future runs. Do not log provider bodies, prompts, API keys or user content. For Gemini 3.8 Flash, set `thinkingLevel=low` because thinking shares the 650-token output ceiling; this might prevent truncation, but does not diagnose the first attempt. Mock tests cover HTTP and token-limit classification.
- Next live experiment requires an independently created/approved dev-store case, explicit authorization for additional potentially billable model calls, and a current scoped key. Compare results against the original one-agent baseline only after actual provider responses and evidence receipts are available. Keep the merchant production pilot unchanged.
