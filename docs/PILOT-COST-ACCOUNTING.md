# Merchant pilot: cost-aware offline reconciliation

**Status:** Exploratory accounting only. No merchant outcomes, cost savings, conversion lift, or production readiness established.

The paired time estimator does **not** incorporate AI provider charges. Labor time savings alone can therefore conceal higher total merchant cost. Use the separate offline `scripts/pilot_cost_estimator.py` before interpreting the labor feasibility screen.

Input CSV: one row per assigned matched topic pair with columns `merchant_id,pair_id,manual_minutes,ai_minutes,ai_provider_usd,hourly_labor_usd`. The hourly labor rate is the predeclared fully loaded USD/hour for the comparable work; use the same rate for both arms unless the study preregisters distinct rates. Provider cost includes measured model, automation and other incremental per-pair API charges, not guessed or fabricated values. **Blank fields are missing, never zero.** A known zero provider charge must be entered as `0`.

Run `python3 scripts/pilot_cost_estimator.py pilot-costs.csv` and `python3 -m unittest discover -s tests -p 'test_pilot_cost_estimator.py' -v`. The script performs no network calls or store writes.

For each complete pair, `manual_cost = manual_minutes × hourly_rate / 60`; `ai_cost = ai_minutes × hourly_rate / 60 + ai_provider_usd`. Savings equal manual cost minus AI cost. Reports include merchant-stratified net observed USD savings, measurement coverage, and whether every merchant has complete observed cost data and positive observed net savings.

**Interpretation:** `all_merchants_observed_net_positive` is a descriptive screen, **not** permission to launch or proof of causal savings. Missing pairs are excluded from observed totals but prevent this flag from passing; missing-not-at-random costs could be worse. The estimator does not include fixed subscription charges, setup, training, supervision, taxes, capital costs, opportunity costs, publishing risk, attribution, quality, customer retention, or revenue. Add these prospectively before a real ROI decision. Do not use these fields for automatic publication, billing or merchant actions. Keep exports pseudonymous and free of buyer data or secrets.

The primary research protocol remains [MERCHANT-PILOT-PROTOCOL.md](MERCHANT-PILOT-PROTOCOL.md); safety, blinded quality, adoption, consent and external integration gates remain mandatory.
