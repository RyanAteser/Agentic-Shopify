"""Offline paired pilot accounting. No Shopify or network access."""
import argparse
import csv
import json
import math
import statistics
from collections import defaultdict


def summarize(rows):
    pairs = defaultdict(dict)
    for row in rows:
        merchant, pair, arm = (row[k].strip() for k in ("merchant_id", "pair_id", "arm"))
        if not merchant or not pair or arm not in ("ai", "manual"):
            raise ValueError("merchant_id, pair_id and arm=ai|manual required")
        key = (merchant, pair)
        if arm in pairs[key]:
            raise ValueError(f"duplicate assignment: {key} {arm}")
        raw = row["active_minutes"].strip()
        minutes = None if raw == "" else float(raw)
        if minutes is not None and (not math.isfinite(minutes) or minutes < 0):
            raise ValueError("minutes must be finite and nonnegative")
        pairs[key][arm] = minutes
    if not pairs:
        raise ValueError("no assignments")
    by_merchant = defaultdict(list)
    for (merchant, pair), arms in pairs.items():
        if set(arms) != {"ai", "manual"}:
            raise ValueError(f"unpaired assignment: {merchant}/{pair}")
        by_merchant[merchant].append(arms)

    def stats(group):
        n = len(group)
        ai_seen = sum(p["ai"] is not None for p in group)
        manual_seen = sum(p["manual"] is not None for p in group)
        complete = [p for p in group if p["ai"] is not None and p["manual"] is not None]
        eligible = [p for p in complete if p["manual"] > 0]
        differences = [p["manual"] - p["ai"] for p in complete]
        percents = [100 * ((p["manual"] - p["ai"]) / p["manual"]) for p in eligible]
        # Individually finite durations can still overflow aggregate totals or
        # percentage ratios (especially with tiny positive manual baselines).
        # Never emit Infinity/NaN as apparently meaningful merchant evidence.
        if any(not math.isfinite(v) for v in differences + percents):
            raise ValueError("derived labor savings must be finite")
        try:
            net_minutes = math.fsum(differences)
        except OverflowError as exc:
            raise ValueError("aggregate labor savings must be finite") from exc
        if not math.isfinite(net_minutes):
            raise ValueError("aggregate labor savings must be finite")
        # Scenario analysis, NOT a mathematical bound: missing pair percentages
        # are assigned 0% savings. This prevents favorable complete-case-only
        # results from silently passing the narrow feasibility screen.
        missing = n - len(complete)
        # Zero-baseline pairs have undefined percentage savings, but should
        # not disappear from the scenario denominator. Treat as neutral
        # here; positive AI labor is separately flagged as an absolute loss.
        zero_baseline = len(complete) - len(eligible)
        neutral_count = missing + zero_baseline
        neutral_missing_median = statistics.median(percents + [0.0] * neutral_count) if percents or neutral_count else None
        coverage = ai_seen / n >= .8 and manual_seen / n >= .8 and len(complete) / n >= .8
        return {
            "assigned_pairs": n,
            "ai_time_coverage": ai_seen / n,
            "manual_time_coverage": manual_seen / n,
            "complete_pairs": len(complete),
            "complete_pair_coverage": len(complete) / n,
            "zero_manual_pairs": len(complete) - len(eligible),
            "zero_manual_ai_labor_loss_pairs": sum(p["manual"] == 0 and p["ai"] > 0 for p in complete),
            "percent_eligible_pairs": len(eligible),
            "median_minutes_saved": statistics.median(differences) if differences else None,
            "net_observed_minutes_saved": net_minutes,
            "net_observed_labor_regression": net_minutes < 0,
            "net_observed_labor_savings_positive": net_minutes > 0,
            "median_percent_saved": statistics.median(percents) if percents else None,
            "missing_pair_zero_savings_scenario_median_percent": neutral_missing_median,
            "missing_pair_zero_savings_scenario_assumption": "Each incomplete pair assigned 0% savings; not a statistical bound",
            "measurement_gate_pass": coverage,
            "feasibility_percent_gate_pass": len(eligible) >= 20 and coverage and statistics.median(percents) >= 20 and neutral_missing_median >= 20,
        }

    overall = stats([p for group in by_merchant.values() for p in group])
    overall["merchant_strata"] = {m: stats(g) for m, g in sorted(by_merchant.items())}
    # Pooled pair counts can hide a merchant whose workflow gets slower.
    # This diagnostic is descriptive, not a new powered statistical test.
    eligible_strata = {
        m: s for m, s in overall["merchant_strata"].items()
        if s["percent_eligible_pairs"] > 0
    }
    overall["merchant_count"] = len(by_merchant)
    overall["merchants_without_percent_observations"] = sorted(
        m for m in by_merchant if m not in eligible_strata
    )
    overall["merchants_with_percent_observations"] = len(eligible_strata)
    # Exploratory replication floor, not a powered merchant-level effect test.
    # A single favorable task cannot stand in for merchant-level evidence.
    overall["merchants_below_replication_floor"] = sorted(
        m for m, stratum in overall["merchant_strata"].items()
        if stratum["percent_eligible_pairs"] < 5
    )
    overall["merchant_median_percent_saved"] = (
        statistics.median(s["median_percent_saved"] for s in eligible_strata.values())
        if eligible_strata else None
    )
    # A positive merchant median is not enough: the pooled 20% screen can
    # conceal a merchant whose own savings are materially below the target.
    # Apply the same zero-savings missing-pair scenario within each merchant.
    overall["merchants_below_sensitivity_savings_target"] = sorted(
        m for m, s in overall["merchant_strata"].items()
        if s["missing_pair_zero_savings_scenario_median_percent"] is None or
        s["missing_pair_zero_savings_scenario_median_percent"] < 20
    )
    overall["merchants_with_nonpositive_median_percent_saved"] = sorted(
        m for m, s in eligible_strata.items() if s["median_percent_saved"] <= 0
    )
    # Pooled coverage can mask severe missingness for a small merchant.
    # Require the same predeclared measurement coverage within each stratum.
    overall["merchants_failing_measurement_coverage"] = sorted(
        m for m, s in overall["merchant_strata"].items()
        if not s["measurement_gate_pass"]
    )
    # Percentage estimates omit zero-baseline pairs. A positive AI duration
    # against zero manual minutes is an observed absolute labor regression.
    # A positive median can conceal one catastrophic, high-duration loss.
    # Observed net labor is descriptive and excludes missing durations.
    overall["merchants_with_net_observed_labor_regression"] = sorted(
        m for m, s in overall["merchant_strata"].items()
        if s["net_observed_labor_regression"]
    )
    # A zero net gain is not evidence of labor savings even if the median
    # percentage is favorable; the pilot must demonstrate positive net time.
    overall["merchants_without_positive_net_observed_savings"] = sorted(
        m for m, s in overall["merchant_strata"].items()
        if not s["net_observed_labor_savings_positive"]
    )
    overall["merchants_with_zero_manual_ai_labor_losses"] = sorted(
        m for m, s in overall["merchant_strata"].items()
        if s["zero_manual_ai_labor_loss_pairs"] > 0
    )
    overall["merchant_heterogeneity_review_required"] = (
        len(eligible_strata) < 2 or
        bool(overall["merchants_without_percent_observations"]) or
        bool(overall["merchants_below_replication_floor"]) or
        bool(overall["merchants_below_sensitivity_savings_target"]) or
        bool(overall["merchants_failing_measurement_coverage"]) or
        bool(overall["merchants_with_nonpositive_median_percent_saved"]) or
        bool(overall["merchants_with_zero_manual_ai_labor_losses"]) or
        bool(overall["merchants_with_net_observed_labor_regression"]) or
        bool(overall["merchants_without_positive_net_observed_savings"])
    )
    # A favorable pooled estimate is not sufficient for a multi-merchant pilot.
    # Keep the original feasibility diagnostic for backwards compatibility.
    overall["multi_merchant_pilot_gate_pass"] = (
        overall["feasibility_percent_gate_pass"] and
        not overall["merchant_heterogeneity_review_required"]
    )
    overall["multi_merchant_pilot_gate_scope"] = (
        "Descriptive labor feasibility only; not a launch, causal, quality, safety, or revenue gate"
    )
    overall["causal_or_revenue_claim_supported"] = False
    return overall


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", help="CSV columns merchant_id,pair_id,arm,active_minutes")
    args = parser.parse_args()
    with open(args.csv_path, newline="", encoding="utf-8-sig") as stream:
        result = summarize(csv.DictReader(stream))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
