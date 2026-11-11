# Prospective Blog Agent dispatch budget (draft, November 2026)

**Status:** Implemented behind an **OFF-by-default** budget-enforcement switch in a draft feature branch. This is not live billing, not an automatic price change, not real invoice reconciliation, and **not a guarantee that a provider cannot charge more than its reserve**. There is no new Shopify API permission, browser-facing budget setter or activated n8n workflow.

## Threat model and reason

Even though the Free plan currently limits job creation to three lifetime drafts, a paid plan could permit many attempts. A retry, delayed scheduler, or merchant who creates thousands of jobs could increase external provider usage. The important control point is not at the button or n8n HTTP response: it is **inside the StoreConfig-locked queued → running claim** and before the first outbound request.

An estimate is not an invoice. This guard controls how many worst-case **reserved allowance cents** can be authorized for dispatch in a UTC month. For a true dollar spend ceiling, the application must also pin provider models, maximum input/output, external API use, orchestrator licensing and vendor-side spend controls.

## Safety invariants

1. The dispatcher first locks the authenticated merchant's existing StoreConfig row, validates that its job is still queued, and validates the current merchant settings. This prevents stale work from bypassing a changed configuration.
2. With BLOG_BUDGET_ENFORCE=true, it requires an explicitly enabled, shop-scoped BlogBudgetPolicy. **No policy = no dispatch.** A disabled policy or invalid amount also blocks. A typo in BLOG_BUDGET_ENFORCE is an error, not silent opt-out.
3. Every successful claim creates one immutable BlogBudgetClaim for that original job, and increments BlogBudgetMonth.committedCents. Both writes and the queued → running transition are in the SAME database transaction. Rollback of any one rolls back all.
4. Concurrent claims for the same merchant are serialized via the StoreConfig row lock, while a conditional update prevents spending beyond the cap. Different merchants have independent counters.
5. A failed pre-POST attempt never posts to n8n; no budget claim persists if the claim transaction throws. However, a claim already committed is never automatically refunded or replayed, even if later work fails or succeeds. Unknown network outcomes may already be billed.
6. An authorized callback that finishes a job does not free its budget claim. A month roll creates a fresh counter; old claims persist for manual reconciliation. The guard counts **prospective exposure**, not settlement invoices.
7. Uninstall and shop-redaction use the same verified merchant eraser and delete policy, monthly counters and job claims. Another merchant's records are unaffected.

**Hard bounds in the prototype:** monthly cap 1–100,000 cents, per-job reserve 1–10,000 cents, and reserve no greater than cap. These only bound configuration errors, not real provider spend. The initial free-trial dispatch behavior is unchanged when enforcement is disabled. **Never activate a paid/public tier with the guard disabled.**

## Operator-only policy provisioning

This CLI changes database policy records only. It does not enable n8n, make AI requests, connect to Shopify or alter subscriptions. It requires an already authenticated/offline Shopify Session and StoreConfig for the exact shop. Set the exact merchant allowlist in the operator environment, **not** in a browser, and run with an appropriate protected production database identity only after a change-control review:

~~~sh
BLOG_BUDGET_POLICY_ADMIN_ENABLED=true
BLOG_BUDGET_POLICY_ADMIN_SHOP=consented.myshopify.com
node --import tsx scripts/set-blog-budget.mts --shop consented.myshopify.com --monthly-cap-cents 250 --per-job-reserve-cents 25 --state enabled
~~~

Windows PowerShell syntax for environment variables is different. This is documentation only: **no owner or merchant budget was enabled**. Set BLOG_BUDGET_ENFORCE=true on a separately authorized app deployment only after validating the correct environment and policy. For an emergency pause, set policy state to paused; this prevents new claims but cannot cancel work already sent.

### Financial meaning

A $2.50 monthly *prospective* authorization with a $0.25/job reserve admits at most ten claims that month. It does **not** mean ten jobs will cost exactly $2.50; vendor costs can be below or above the assumed per-job amount. No merchant is automatically charged for these internal reservations.

The prior unit-economics scenario module shows $49/$149/$399 plan revenue and 70% contribution-margin service ceilings. This dispatch guard does **not** derive entitlements from those hypothetical prices. Pricing/billing must be verified through Shopify App Pricing and vendor invoices before enabling any paid feature.

## Required staging tests and business gates

- SQLite: missing, disabled and invalid policy fail closed; exact-tenant isolation; settings snapshot; no duplicate claim; UTC month roll; no refund of uncertain network exposure; full privacy erasure.
- PostgreSQL: competing claims cannot exceed a shared merchant cap and only successful claimants transition to running.
- CI: schema migration, TypeScript/build, web workflow regressions, Docker runtime.
- **Not yet demonstrated:** Actual live n8n POST with enforced budget; provider-side dollar billing ceilings; verified real client invoices; automatic provider-cost settlement; license terms; per-tier quotas; Shopify payout verification.
- Before production: enforce exact provider request limits, optional vendor-side account budget alerts, incident reconciliation and an audited operator review process for confirmed non-billed claims.
