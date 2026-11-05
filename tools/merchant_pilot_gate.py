#!/usr/bin/env python3
"""Read-only pilot decision gate: reconcile assignments before reporting paired labor."""
import argparse
import json
from pathlib import Path

from tools.merchant_pilot_manifest import KEYS, load_csv, verify
from tools.merchant_value_pilot import FIELDS, analyze


def evaluate(manifest_rows, observed_rows):
    reconciliation = verify(manifest_rows, observed_rows)
    accounting = analyze(observed_rows)
    ready = (reconciliation["manifest_matches"] and accounting["accounting_comparison_ready"]
             and all(accounting[arm]["useful"] > 0 for arm in ("ai", "control")))
    # Lower labor with zero useful output is not a merchant productivity win.
    # An apparently balanced export can omit both sides of an assignment pair.
    # Never expose a comparison estimate unless the frozen manifest reconciles.
    if not ready:
        accounting["merchant_weighted_labor_difference_minutes_per_assignment"] = None
        accounting["merchants_with_lower_ai_labor"] = None
    accounting["accounting_comparison_ready"] = ready
    return {
        "comparison_ready": ready,
        "reconciliation": reconciliation,
        "accounting": accounting,
        "interpretation": (
            "Descriptive paired accounting only. A reconciled manifest is necessary, "
            "not proof of preregistration, randomization, causal savings, SEO or revenue lift."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("observed", type=Path)
    args = parser.parse_args()
    report = evaluate(load_csv(args.manifest, KEYS), load_csv(args.observed, FIELDS))
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report["comparison_ready"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
