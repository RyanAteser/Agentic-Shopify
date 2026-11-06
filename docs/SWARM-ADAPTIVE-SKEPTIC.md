# Adaptive Skeptic V1: gated Shopify research
Date: November 6, 2026. Development-only experimental extension, stacked on grounded A/B PR #15.

## Why change the research architecture?

The previous six-call swarm repeatedly agreed with a source-grounded single Gemini answer and failed to persist a final skeptic verdict in one trial. It produced no completed paired evidence of higher accuracy. A new diagnostic with a dummy key also showed why the model runner and read-only preflight must remain separate. Unbounded debate is not justified by available observations.

**Decision:** For SEO research, launch one independent specialist with a verified authenticated Shopify Admin snapshot. A deterministic policy decides whether two skeptic calls are warranted. Do not equate either path with SEO success or business lift. A user may still allocate multiple agents by role in the existing Team UI, but runtime is intentionally bounded to one specialist and one skeptic in a three-person frozen roster for this pilot.

## State machine

1. Verify exact shop allowlist, active Shopify installation, 2 SEO specialists plus 1 independently assigned skeptic, fresh (under 24h) shop-identity-validated read-only snapshot, eligible queued case, and verified free-tier request budget.
2. Reserve at most **three model-request attempts** transactionally under the shop lock. The existing 25 monthly attempt-credit cap continues to apply. Reservation is not payment or a verified invoice.
3. Claim the first request in an immutable invocation ledger BEFORE provider POST; send one Gemini specialist its distinct research lane and the snapshot. It must return a bounded JSON claim, an explicit falsifier, and, for classification use, an ANSWER: YES|NO|INSUFFICIENT first line.
4. Apply versioned deterministic gate adaptive-skeptic-v1. Escalate on any unverified external outcome (Google indexing, traffic, rank, sales, conversions, ROI), uncertain/malformed answer, lack of exact verified Admin fact citation in the model text, conflicting store fact, unverified source URL, sample truncation, missing falsifier, a merchant-action proposal, or causal claims without underlying evidence. Persist only the structured reason codes and answer label as an attributed system evidence message.
5. On no escalation: **stop after one model call**. Release the remaining two reservations. Case status remains needs_evidence; NO claim is marked approved. The output is a provisional grounded explanation only.
6. On escalation: the assigned skeptic first challenges the specialist using the same verified facts plus deterministic reasons; the skeptic next issues a verdict. The application forcibly records an unverified positive verdict as **abstain**, so no Shopify action can be approved. The run uses at most **three** total calls.
7. On timeout, crash, malformed provider output, stale execution, persistence uncertainty or quota conflict: mark blocked_uncertain, release only unattempted reservations, never refund claimed calls automatically, never retry the case.

The skeptic does not fetch citations or Google Search Console data. The gateway is deliberately conservative and lexical in V1; a risk trigger is a call-allocation heuristic, not a calibrated probability of factual error or actual causal proof.

## Why this might create value

All else equal, expected request cost is E[C] = C1 + Pr(escalation)*(C2+C3), rather than C1+C2+C3+... for routine cases. But source changes, model length, provider billings and failures matter. A lower average token bill does NOT imply higher verified decision quality. Hidden-failure tests and false-negative inspection are necessary before trusting the automatic early exit.

## Integration and controls

- New app/lib/adaptive-skeptic-policy.ts: pure, versioned, falsifiable escalation gate.
- New app/lib/adaptive-skeptic.server.ts: event-driven staged worker, retained frozen team and separate skeptic challenge/verdict, no HTTP endpoint.
- Existing app/lib/swarm-executor.server.ts: shared transactional leasing, unique request claims, monthly reservations, reconcile semantics. Adaptive maxCalls=3 with correct 1-stage or 3-stage completion checks. Full six-call flow remains unchanged.
- Team UI: execution plan and system routing record displayed next to attributed model output. Queueing still uses Shopify-authenticated server action; customer-facing app cannot trigger the manual model runner.
- scripts/run-swarm-adaptive.mts: one-shot operator-only worker with exact shop allowlist and owner flags. Local protected owner launcher is stored outside the repository at %LOCALAPPDATA%/AgenticShopify/run-adaptive-owner.ps1; it asks for confirmation, loads a DPAPI encrypted credential, and never commits the key. No recurring scheduler is enabled.
- No content edits, publishing, pricing, inventory, order changes, customer data operations, n8n automation, subscription billing activation or live Monika Blunder Beauty deployment. The current app is a developer pilot only.

## Test matrix and rejection rules

- Pure routing: clear local source-linked claim (one call); external indexing/traffic questions (skeptic); conflicting/missing facts; fabricated URLs; truncated sample; merchant mutation; missing falsifier and explicit abstention.
- Deterministic synthetic provider end-to-end: one-call early exit, three-call skeptic debate, forced abstention, no approvals, tenant isolation, unique execution attempts, monthly credit accounting and uninstall data redaction.
- Failure injection: uncertain second call consumes precisely two request credits, releases unused third and cannot replay.
- Real PostgreSQL concurrency: concurrent three-credit reservations against three remaining monthly credits cannot both succeed.
- Full existing suite, TypeScript, Docker smoke and PostgreSQL migration compatibility must pass before the draft is considered ready.
- Reject production activation if any early exit recommends a Shopify write, if any claimed call is automatically refunded, if skeptic source provenance is fabricated, if tenant isolation fails, or if controlled held-out evaluation shows a material factual false-negative increase.

## Recommended next empirical test

Use a new, independent set of 30+ preregistered, held-out merchant evidence tasks with blinded adjudication. Compare 1-call baseline, adaptive 1-or-3-call policy, and the previous six-call swarm. Measure factual error, false-negative early exits, abstention calibration, measured token cost, completion/timeout rate, and review minutes. A simple single-agent solution remains preferable unless adaptive skepticism shows a reproducible quality-adjusted advantage. Do not reuse the first two benchmark questions as independent held-out examples, and do not infer profitable alpha or SEO growth.

## First real Gemini adaptive smoke test (November 6, 2026)

After draft PR #16 CI passed all three jobs (application, PostgreSQL, Docker), a single shop-isolated Artemis dev-store case cmw5kagvn0000uz44a29pz1jx was created from a new authenticated Shopify Admin 2026-10 snapshot. The factual question was whether any active published Online Store products existed; source field publishedActiveProductsInSample was **13**. User-authorized manual DPAPI launcher ran the fixed three-call ceiling.

Execution cmw5kawn70000uzq8qa28or3o completed **3 attempted and committed Gemini calls** (2,046 input tokens; 516 output+thinking tokens), no errors, final **needs_evidence** and no Shopify edits. The initial specialist answer was factually correct and grounded: **"ANSWER: YES. According to the authenticated Shopify Admin ... publishedActiveProductsInSample is 13"**. However, the initial operational parser required YES to be followed by a line break, not a period; it misclassified a correct result as absent and triggered the skeptic twice. Both skeptic messages also answered YES from the same source. The persisted reason was NONFINAL_OR_ABSTAINING_ANSWER; **that reason was a formatting false positive, not substantive uncertainty**. The skeptic verdict remained abstain by design, not a merchant endorsement. November dev-store attempt meter rose from 15 to **18 of 25**.

Prospective correction: the **adaptive operational** gate now permits a single-line "ANSWER: YES. Explanation" or "ANSWER: YES! Explanation" and continues to reject ambiguous tokens such as ANSWER: YESNO. Focused tests pass; **the original preregistered benchmark parser remains unchanged**, avoiding retrospective scoring changes. The completed case is not retried.

The test proves the adapter and 3-call path operate live. It does NOT demonstrate adaptive cost saving, since a formatting mismatch forced escalation. A separate new, grounded low-risk case is required to verify the one-call early exit on live Gemini.
