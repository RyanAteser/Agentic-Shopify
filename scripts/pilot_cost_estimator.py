"""Offline paired labor-plus-provider cost accounting. No network or store access."""
import csv
import json
import math
import sys
from collections import defaultdict


def summarize_costs(rows, fixed_costs_usd=None):
    """One record per matched topic pair; amounts are USD and minutes."""
    groups = defaultdict(list)
    seen = set()
    required_columns = {"merchant_id", "pair_id", "manual_minutes", "ai_minutes", "ai_provider_usd", "hourly_labor_usd"}
    for row in rows:
        if not isinstance(row, dict) or set(row) != required_columns or any(not isinstance(value, str) for value in row.values()):
            raise ValueError("cost row must contain exactly the six required string columns; reject malformed CSV or schema drift")
        merchant = row["merchant_id"].strip()
        pair = row["pair_id"].strip()
        if not merchant or not pair or (merchant, pair) in seen:
            raise ValueError("merchant/pair IDs must be nonempty and unique")
        seen.add((merchant, pair))
        values = {}
        for field in ("manual_minutes", "ai_minutes", "ai_provider_usd", "hourly_labor_usd"):
            raw = row[field].strip()
            if not raw:
                values[field] = None
                continue
            value = float(raw)
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{field} must be finite and nonnegative")
            values[field] = value
        groups[merchant].append(values)
    if not seen:
        raise ValueError("no assigned pairs")

    if fixed_costs_usd is not None:
        if set(fixed_costs_usd) != set(groups):
            raise ValueError("fixed costs must be provided for every assigned merchant, with no extras")
        for merchant, amount in fixed_costs_usd.items():
            if not isinstance(amount, (int, float)) or isinstance(amount, bool) or not math.isfinite(amount) or amount < 0:
                raise ValueError(f"invalid fixed cost for merchant {merchant}")

    def calculate(items, fixed_cost=None):
        complete = [r for r in items if all(v is not None for v in r.values())]
        savings = []
        stressed_savings = []
        for r in complete:
            rate = r["hourly_labor_usd"] / 60
            manual_cost = r["manual_minutes"] * rate
            ai_cost = r["ai_minutes"] * rate + r["ai_provider_usd"]
            delta = manual_cost - ai_cost
            if not all(math.isfinite(v) for v in (manual_cost, ai_cost, delta)):
                raise ValueError("derived cost must be finite")
            savings.append(delta)
            # Scenario, not a confidence interval: 25% AI labor and API cost overrun.
            stressed_ai_cost = 1.25 * (r["ai_minutes"] * rate + r["ai_provider_usd"])
            stressed_delta = manual_cost - stressed_ai_cost
            if not all(math.isfinite(v) for v in (stressed_ai_cost, stressed_delta)):
                raise ValueError("derived sensitivity cost must be finite")
            stressed_savings.append(stressed_delta)
        try:
            total = math.fsum(savings)
            stressed_total = math.fsum(stressed_savings)
        except OverflowError as exc:
            raise ValueError("aggregate cost must be finite") from exc
        if not all(math.isfinite(v) for v in (total, stressed_total)):
            raise ValueError("aggregate cost must be finite")
        net_fixed = None if fixed_cost is None else total - fixed_cost
        stressed_fixed = None if fixed_cost is None else stressed_total - fixed_cost
        if not all(math.isfinite(v) for v in (net_fixed, stressed_fixed) if v is not None):
            raise ValueError("fixed-cost adjusted total must be finite")
        return {
            "assigned_pairs": len(items),
            "complete_cost_pairs": len(complete),
            "cost_coverage": len(complete) / len(items),
            "observed_net_usd_saved": total,
            "observed_net_positive": total > 0,
            "stressed_net_usd_saved": stressed_total,
            "stressed_net_positive": stressed_total > 0,
            "cost_evidence_sufficient": len(complete) == len(items),
            "fixed_cost_usd": fixed_cost,
            "net_after_fixed_usd": net_fixed,
            "stressed_net_after_fixed_usd": stressed_fixed,
        }

    strata = {merchant: calculate(items, None if fixed_costs_usd is None else fixed_costs_usd[merchant])
              for merchant, items in sorted(groups.items())}
    overall = calculate([item for items in groups.values() for item in items])
    overall["merchant_strata"] = strata
    overall["all_merchants_observed_net_positive"] = all(
        s["observed_net_positive"] and s["cost_evidence_sufficient"]
        for s in strata.values()
    )
    overall["all_merchants_stressed_net_positive"] = all(
        s["stressed_net_positive"] and s["cost_evidence_sufficient"]
        for s in strata.values()
    )
    overall["all_merchants_net_after_fixed_positive"] = fixed_costs_usd is not None and all(
        s["cost_evidence_sufficient"] and s["net_after_fixed_usd"] > 0 for s in strata.values()
    )
    overall["all_merchants_stressed_after_fixed_positive"] = fixed_costs_usd is not None and all(
        s["cost_evidence_sufficient"] and s["stressed_net_after_fixed_usd"] > 0 for s in strata.values()
    )
    overall["launch_or_revenue_claim_supported"] = False
    return overall


if __name__ == "__main__":
    fixed = None
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as costs:
            fixed = json.load(costs)
        if not isinstance(fixed, dict):
            raise ValueError("fixed costs JSON must map merchant IDs to USD amounts")
    with open(sys.argv[1], newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        expected = {"merchant_id", "pair_id", "manual_minutes", "ai_minutes", "ai_provider_usd", "hourly_labor_usd"}
        if reader.fieldnames is None or len(reader.fieldnames) != len(expected) or set(reader.fieldnames) != expected:
            raise ValueError("cost CSV header must contain exactly six unique required columns")
        print(json.dumps(summarize_costs(reader, fixed), indent=2))
