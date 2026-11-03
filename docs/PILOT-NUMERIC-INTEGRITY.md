# Pilot numeric integrity

The offline `scripts/pilot_pair_estimator.py` rejects nonfinite or negative input durations. It now also rejects nonfinite derived percentage savings and aggregate observed net labor savings. Even finite input durations can overflow arithmetic when an AI duration is enormous relative to a tiny positive manual baseline, or when many large savings are added. Such data must not become JSON `Infinity` or `NaN` and must not silently pass a merchant feasibility gate.

The implementation computes percentages as `100 * ((manual - ai) / manual)` and aggregates differences with `math.fsum`, returning a descriptive error if arithmetic overflows. Regression tests exercise extreme ratios and overflowed aggregates. This is input integrity, not a statistical inference or merchant outcome.

**Operational response:** Investigate unit mismatch, import corruption, and unrealistic measurements before rerunning the estimator. Do not silently clip, winsorize, replace with zero, or remove extreme records to obtain a pass. The estimator does not calculate provider charges, customer acquisition, SEO lift, attribution, or causal labor effects. An approved prospective pilot and separate safety/quality gates remain mandatory. No merchant-facing action is authorized by an estimator result.
