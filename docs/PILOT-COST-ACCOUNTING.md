# Merchant pilot: cost-aware offline reconciliation

**Status:** Exploratory accounting only. No merchant outcomes, cost savings, conversion lift, or production readiness established.

The paired time estimator does **not** incorporate AI provider charges. Labor time savings alone can therefore conceal higher total merchant cost. Use the separate offline `scripts/pilot_cost_estimator.py` before interpreting the labor feasibility screen.

Input CSV: one row per assigned matched topic pair with columns `merchant_id,pair_id,manual_minutes,ai_minutes,ai_provider_usd,hourly_labor_usd`. The hourly labor rate is the predeclared fully loaded USD/hour for the comparable work; use the same rate for both arms unless the study preregisters distinct rates. Provider cost includes measured model, automation and other incremental per-pair API charges, not guessed or fabricated values. **Blank fields are missing, never zero.** A known zero provider charge must be entered as `0`.

Run `python3 scripts/pilot_cost_estimator.py pilot-costs.csv` and `python3 -m unittest discover -s tests -p 'test_pilot_cost_estimator.py' -v`. The script performs no network calls or store writes.

For each complete pair, `manual_cost = manual_minutes × hourly_rate / 60`; `ai_cost = ai_minutes × hourly_rate / 60 + ai_provider_usd`. Savings equal manual cost minus AI cost. Reports include merchant-stratified net observed USD savings, measurement coverage, and whether every merchant has complete observed cost data and positive observed net savings.

**Interpretation:** `all_merchants_observed_net_positive` is a descriptive screen, **not** permission to launch or proof of causal savings. Missing pairs are excluded from observed totals but prevent this flag from passing; missing-not-at-random costs could be worse. The estimator does not include fixed subscription charges, setup, training, supervision, taxes, capital costs, opportunity costs, publishing risk, attribution, quality, customer retention, or revenue. Add these prospectively before a real ROI decision. Do not use these fields for automatic publication, billing or merchant actions. Keep exports pseudonymous and free of buyer data or secrets.

The primary research protocol remains [MERCHANT-PILOT-PROTOCOL.md](MERCHANT-PILOT-PROTOCOL.md); safety, blinded quality, adoption, consent and external integration gates remain mandatory.

## Cost-overrun sensitivity (exploratory)

The estimator now also reports `stressed_net_usd_saved`, `stressed_net_positive` and `all_merchants_stressed_net_positive`. This scenario raises **both AI-assisted human minutes and measured variable AI provider charges by 25%**, holding the manual comparator and predeclared labor rate constant. Each assigned merchant must have complete paired costs and positive stressed net savings to pass the stressed screen. A merchant with positive observed savings but negative stressed savings is fragile to modest overruns and should not be treated as an economically robust pilot.

The 25% factor is an **illustrative stress assumption**, not a measured forecast, confidence bound or preregistered decision threshold. Change it only through an explicit protocol amendment before observing outcomes. It does not account for fixed subscription fees, implementation costs, downstream quality errors or revenue attribution; those still require separate prospective measurements. A positive stress result never authorizes store changes, publication, billing or launch.

## Fixed overhead reconciliation (optional, offline)

Variable-cost savings are not merchant ROI. The optional second CLI argument is a UTF-8 JSON object mapping **every** pseudonymous merchant ID to that merchant's **total incremental fixed USD expense for the exact pilot observation period**, e.g. `{"merchant-a": 50.0, "merchant-b": 0.0}`. Run `python3 scripts/pilot_cost_estimator.py pilot-costs.csv fixed-costs.json`. Include attributable subscriptions, onboarding and implementation costs where measured; never insert estimated zero when a charge is unknown. The period and allocation method must be preregistered. The mapping must cover exactly the merchants in the CSV, preventing costs being silently assigned to another tenant. Do not include buyer identifiers, credentials or payment details.

Per merchant, `net_after_fixed_usd = observed_net_usd_saved - fixed_cost_usd` and `stressed_net_after_fixed_usd = stressed_net_usd_saved - fixed_cost_usd`. The corresponding all-merchant positive flags require complete pair measurements, an explicit fixed-cost mapping and strictly positive adjusted savings for **every** merchant. Without the JSON, adjusted results are `null` and both flags are false, rather than assuming overhead is zero. This remains a descriptive feasibility screen, not a causal or production launch gate. Avoid double-counting provider fees already included in per-pair variable costs. A pilot with shared infrastructure must use a documented, defensible merchant allocation method. The estimator does not independently verify cost invoices, causal attribution, content quality or downstream merchant revenue.

## Input-schema integrity

The offline estimator now rejects malformed rows, unexpected columns, non-string cells, missing columns, extra CSV fields, and duplicate CSV headers rather than silently ignoring them. The CLI accepts exactly six unique column names (in any order). This guards against a mistyped provider-cost column, shifted CSV export, or duplicate header making pilot economics appear complete when the input is corrupt. Correct the source export and rerun; do not treat validation errors as zero costs. These checks validate structure, **not** the authenticity of labor logs or provider invoices.
