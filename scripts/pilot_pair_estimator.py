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
        percents = [100 * (p["manual"] - p["ai"]) / p["manual"] for p in eligible]
        coverage = ai_seen / n >= .8 and manual_seen / n >= .8
        return {
            "assigned_pairs": n,
            "ai_time_coverage": ai_seen / n,
            "manual_time_coverage": manual_seen / n,
            "complete_pairs": len(complete),
            "zero_manual_pairs": len(complete) - len(eligible),
            "percent_eligible_pairs": len(eligible),
            "median_minutes_saved": statistics.median(differences) if differences else None,
            "median_percent_saved": statistics.median(percents) if percents else None,
            "measurement_gate_pass": coverage,
            "feasibility_percent_gate_pass": bool(eligible) and coverage and statistics.median(percents) >= 20,
        }

    overall = stats([p for group in by_merchant.values() for p in group])
    overall["merchant_strata"] = {m: stats(g) for m, g in sorted(by_merchant.items())}
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
