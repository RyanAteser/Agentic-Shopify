#!/usr/bin/env python3
"""Read-only, privacy-minimal merchant pilot accounting. No Shopify or n8n access."""
import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

FIELDS = {"merchant_id", "brief_id", "arm", "status", "labor_minutes", "useful", "provider_cost_usd"}
ARMS = {"ai", "control"}
STATUSES = {"completed", "abandoned", "failed"}

def analyze(rows):
    seen = set()
    groups = defaultdict(list)
    merchant_arms = defaultdict(set)
    merchant_arm_counts = defaultdict(lambda: defaultdict(int))
    for line, row in enumerate(rows, 2):
        if not FIELDS.issubset(row):
            raise ValueError("Missing required columns")
        merchant, brief, arm = row["merchant_id"], row["brief_id"], row["arm"]
        if not merchant or not brief or arm not in ARMS or row["status"] not in STATUSES:
            raise ValueError(f"Invalid assignment on row {line}")
        key = (merchant, brief)
        if key in seen:
            raise ValueError(f"Duplicate assignment on row {line}")
        seen.add(key)
        if row["useful"] not in {"0", "1"}:
            raise ValueError(f"Invalid usefulness on row {line}")
        useful = row["useful"] == "1"
        if useful and row["status"] != "completed":
            raise ValueError(f"Noncompleted useful task on row {line}")
        labor = row["labor_minutes"].strip()
        cost = row["provider_cost_usd"].strip()
        try:
            minutes = None if labor == "" else float(labor)
            dollars = float(cost)
        except ValueError as exc:
            raise ValueError(f"Invalid numeric value on row {line}") from exc
        if (minutes is not None and (minutes < 0 or minutes != minutes or minutes == float("inf"))) or dollars < 0 or dollars != dollars or dollars == float("inf"):
            raise ValueError(f"Invalid nonnegative finite value on row {line}")
        groups[arm].append((minutes, dollars, useful, row["status"]))
        merchant_arms[merchant].add(arm)
        merchant_arm_counts[merchant][arm] += 1
    result = {}
    for arm in sorted(ARMS):
        items = groups[arm]
        n = len(items)
        observed = sum(x[0] is not None for x in items)
        useful_count = sum(x[2] for x in items)
        known_minutes = sum(x[0] for x in items if x[0] is not None)
        total_cost = sum(x[1] for x in items)
        # Do not treat missing labor as zero or present a biased per-useful estimate.
        result[arm] = {
            "assigned": n,
            "completed": sum(x[3] == "completed" for x in items),
            "completion_rate": sum(x[3] == "completed" for x in items) / n if n else None,
            "useful": useful_count,
            "useful_rate_per_assigned": useful_count / n if n else None,
            "labor_observed": observed,
            "labor_coverage": observed / n if n else None,
            "known_labor_minutes_lower_bound": known_minutes,
            "labor_minutes_per_assigned": known_minutes / n if n and observed == n else None,
            "labor_minutes_per_useful": known_minutes / useful_count if n and observed == n and useful_count else None,
            "provider_cost_usd": round(total_cost, 4),
            "provider_cost_per_useful_usd": round(total_cost / useful_count, 4) if useful_count else None,
        }
    # A pooled comparison across disjoint merchants confounds merchant differences with arm.
    paired_merchants = sum(arms == ARMS for arms in merchant_arms.values())
    result["merchants_total"] = len(merchant_arms)
    result["merchants_with_both_arms"] = paired_merchants
    # Each merchant must contribute equally to both arms before pooled arm
    # descriptives can be treated as balanced assignment-level accounting.
    balanced_merchants = sum(counts["ai"] > 0 and counts["ai"] == counts["control"]
                             for counts in merchant_arm_counts.values())
    result["merchants_with_balanced_arms"] = balanced_merchants
    result["accounting_comparison_ready"] = (balanced_merchants == len(merchant_arms) and balanced_merchants > 0
        and all(result[a]["assigned"] > 0 and result[a]["labor_coverage"] == 1 for a in ARMS))
    result["interpretation"] = "Descriptive feasibility accounting only; missing labor prevents per-useful labor estimate. No causal or revenue claims."
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    args = parser.parse_args()
    with args.csv_path.open(newline="", encoding="utf-8") as stream:
        result = analyze(csv.DictReader(stream))
    print(json.dumps(result, indent=2, sort_keys=True))

if __name__ == "__main__":
    main()
