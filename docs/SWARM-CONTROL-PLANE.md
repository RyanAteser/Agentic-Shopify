# Multi-agent swarm control plane (draft feature, November 2026)

**Status:** Backend schema, role roster, subscription gate, Team UI and a typed
inter-agent message ledger are implemented in a **feature branch**. No model
provider is connected, no paid subscription is active, no autonomous execution
is deployed, and no merchant-store changes are made by this control plane.

## Why this is not simply “more ChatGPT bots”

Twenty copies of the same instructions are not independent evidence. An
effective swarm assigns **different search spaces, evidence sources, methods,
counterfactuals and falsification duties**, then rejects proposals that fail
replication. Token spending and agent count are costs, not results. The product
should sell verified merchant value, not arbitrary model messages.

### Core vocabulary

- **Specialist**: persistent merchant-selected slot tied to one of the 10
  existing role definitions (SEO, blog/content, merchandise, analytics, etc.).
  A specialist's saved configuration does not imply that an executable model
  exists. Future worker configuration includes tools, scoped data access,
  provider tier, immutable model version, per-run budget and unique strategy.
- **Swarm**: a temporary, finite **research case** with independently assigned
  specialists, a fixed brief, staged debate and a hard deadline. It is not a
  permanent busy loop. Six SEO slots could participate in one six-specialist
  research case or smaller research cells.
- **Skeptic**: a **system-managed** challenger, allocated per role. At least
  \`ceil(specialists_in_role/5)\` are needed. Hence 6 SEO + 2 blog = 8
  specialists and **3** skeptics, not 2 pooled skeptics. The merchant cannot
  simply opt out of a reviewer to save compute.
- **Research case**: hypothesis, measurable baseline/metric, and explicit
  rejection rule before execution. Not an instruction to mutate Shopify.
- **Message**: immutable, tenant-scoped, typed envelope with attributed sender,
  optional recipient, evidence URLs, falsifier and (skeptic-only) verdict.
- **Experiment**: pre-registered traffic/content/crawl test with holdout and
  attribution constraints. A proposal is not evidence of successful SEO.

## UI delivered in app.team.tsx

The existing static Team route is now an editable, authenticated capacity
console. Every role shows specialists, derived skeptics, descriptive purpose and
a slot form. There is a global plan limit, free-only when billing is not
verified, a research brief form and a read-only case ledger.

The UI must NOT claim that a queued brief was answered. Until an approved model
provider and durable queue exist, cases remain **queued**, and the ledger
contains only real routing envelopes. Future screens should add: Activity
(queued/running/blocked/cost/refund), Debate (sourced claims, critiques,
counterevidence, rebuttals, final skeptic verdicts), Approval, and Results
(held-out lift). Keep concise summaries prominent and transcripts inspectable.

## Proposed entitlements, not live merchant charges

| Plan hypothesis | Price/month | Specialist slots | Research credits/mo | Skeptics |
| --- | ---: | ---: | ---: | --- |
| Free | $0 | 2 | 25 | Included |
| Starter | $29 | 5 | 150 | Included |
| Growth | $79 | 15 | 600 | Included |
| Scale | $199 | 50 | 2,000 | Included |

A research credit is **not yet a spendable unit**: no provider calls or credit
reservations have been enabled. Before going live, define e.g. a fixed 1,000
model-token-equivalent cost basis that charges *actual* tokens and tool/search
costs, count skeptic calls, enforce per-run + monthly ceilings and lock credits
before dispatch. Count a configured specialist only once; a queued research case
must not silently trigger unbounded model invocations.

The existing Blog Agent ($19/39/99 proposal) and broader Store OS ($49/149/399
proposal) are separate, **unactivated** hypotheses; do not silently combine
or charge twice. Validate willingness to pay and provider COGS before pricing.

**Billing source of truth:** Shopify App Pricing is Shopify's 2026 default for
public apps, with Partner API activeSubscription and App Events for billed
usage. The code currently contains a **gated preliminary adapter** to
\`currentAppInstallation.activeSubscriptions\` that returns FREE unless
\`SWARM_BILLING_ENABLED=true\` and an exact active app-specific subscription
is observed. Before activation, integrate and reconcile the appropriate
**Partner App Pricing** API and webhook/billing event semantics, plan IDs,
cancellation, freeze and scheduled downgrade, and test this against a real
public app in a Shopify development store. Custom one-merchant pilot billing
does not prove general app billing. Never grant paid capacity from a client
form, an arbitrary plan name, or an unverified webhook.

## Server-side trust boundaries

- Tenant derived only from \`authenticate.admin\` and persisted Session; no
  \`shop\` supplied by a form is read as authority.
- Every capacity change transaction locks **Session -> StoreConfig -> SwarmAgent**
  so concurrent forms cannot overspend slots or race uninstall/redaction.
- Redaction deletes \`SwarmMessage\`, \`SwarmCase\`, and \`SwarmAgent\` records.
- Retiring a specialist also retires unnecessary skeptics and pauses outstanding
  cases to prevent stale assignees from executing.
- Entitlement decreases do **not silently delete** previously configured
  workers; the UI shows over-quota and refuses new cases, but permits reduction.
- A run's participant IDs and review round are snapshotted. A revision increments the review round, invalidating earlier challenges and skeptic verdicts. Cross-role messages can
  only address **active agents in the same shop**. An agent can reply after
  an explicit same-shop invitation. Workers cannot impersonate skeptics.
- \`recordSwarmWorkerMessage\` is **server-only**, gated by
  \`SWARM_EXECUTION_ENABLED\`, and is intentionally not exposed as an HTTP
  endpoint. This flag alone is **not a safe production activation mechanism**
  until a durable queue, caller authentication, idempotency and cost meter
  are implemented.
- Research-case statuses include queued, researching, challenged,
  needs_evidence, rejected, awaiting_merchant_review, and paused.
  A skeptic cannot sign a verdict without first recording a challenge,
  and verdicts require evidence plus a failure condition.
- No worker can bypass Shopify scopes or the existing human approval and
  publication policy. In particular, the separately deployed MBB read-only
  pilot continues to block /app/team and all merchant writes.

## Agent debate protocol and independent discovery

1. **Freeze a brief** containing objective, data scope, time window, intended
   business metric, selection method, baseline and rejection threshold.
2. **Diverge deliberately**: coordinator assigns distinct mechanisms to workers,
   e.g. SEO technical/canonical, search demand, internal links, customer intent,
   competing templates, and counterfactual/causal design. Do not show agents
   each other's ideas before the first independent pass.
3. **Exchange evidence envelopes**: typed \`hypothesis\`, \`evidence\`,
   \`challenge\`, \`revision\`, \`verdict\`. Provenance includes exact URL/source,
   retrievedAt, data version, confidence range and failed assumptions.
   Current schema stores URLs and falsifiers; source timestamps and per-tool
   receipts must be added before live worker activation.
4. **Adversarial stage**: one independent skeptic per five specialists *per
   role*, demanding alternative explanations, stale-data checks, null tests,
   cross-product effects, cost accounting and a no-change control. Additional
   independent validators can be shared across separate roles for cross-domain
   critiques, but do not replace required role skeptics.
5. **Converge by evidence**: only a verdict from each assigned skeptic can
   make a case \`awaiting_merchant_review\`. This does not authorize Shopify
   changes. A skeptic may reject or abstain; disagreeing evidence remains in
   the ledger.
6. **Execute a controlled experiment**: use an explicit merchant-approved
   diff, rollback plan, holdout and minimum meaningful effect. Expose whether
   a finding is speculation, a single observation, a replicated observation,
   an approved intervention, or a verified net business result.

No system can guarantee novel discoveries. Track *incremental verified value*
per cost and compare swarm outcomes with a cheaper one-agent baseline. Kill
agents that increase token spend without increasing confirmed testable output.

## Worker integration design (next phase)

Use the existing Node/React Router API as the **control plane** and PostgreSQL
for durable tasks/messages/entitlements. Run **separate bounded workers** via
a fixed queue, not one long-lived HTTP request. Each worker claims a case under
a lease and fencing token, emits a signed typed envelope, and obeys a fixed
per-run instruction and provider budget. The coordinator should schedule:

- Independent parallel research, then a bounded debate with two passes maximum.
- One synthesis pass, then mandatory skeptical verdicts.
- Optional cross-role handoff through a same-tenant message envelope.
- Merchant approval in the existing Store Manager inbox.
- Evidence-based before/after evaluation, no automated vanity metrics.

Do **not** start with n8n as the user-editable agent graph: the existing n8n
workflow may have OEM licensing implications for a resold multi-tenant
workflow-builder product. n8n may remain a fixed internal blog worker pending
license review; the core message and policy engine should remain provider and
orchestrator agnostic.

## Validation gates and rollout

1. **Control-plane CI**: typecheck, schema sync, PostgreSQL migrations, tenant
   isolation and redaction, concurrent quotas, skeptic invariants, worker
   envelope role controls, paused cases and fail-closed subscription state.
2. **Offline worker replay**: fake two competing SEO methods, one deliberate
   hallucination, one independent skeptic. Reject unsupported claim and prevent
   publish. No real credentials or outbound model calls.
3. **Owner-only read-only pilot**: one SEO specialist + one skeptic; cap total
   calls at 2-4 per problem; compare against a single-agent control and
   baseline real storefront metrics, no paid charges.
4. **Provider costs / user value**: measure useful proposals reviewed,
   reproducibility, support burden, latency and all-in cost. Increase role
   slots only when value per run exceeds spending.
5. **Paid launch**: only after Shopify App Pricing enrollment, signed billing
   webhook state, usage credits and top-up consent, retries/refunds, workers,
   privacy review, strict resource budgets and failure-injection tests.
