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
