#!/usr/bin/env python3
"""Verify observed pilot assignments against a frozen, pseudonymous assignment manifest."""
import argparse
import csv
import json
from pathlib import Path

KEYS = ("merchant_id", "brief_id", "arm")
ARMS = {"ai", "control"}

def verify(manifest, observed):
    def index(rows, source):
        result = {}
        for line, row in enumerate(rows, 2):
            if not all(k in row for k in KEYS):
                raise ValueError(f"{source}: missing required columns")
            key = (row["merchant_id"], row["brief_id"])
            if not all(key) or row["arm"] not in ARMS:
                raise ValueError(f"{source}: invalid assignment on row {line}")
            if key in result:
                raise ValueError(f"{source}: duplicate assignment on row {line}")
            result[key] = row["arm"]
        return result
    planned = index(manifest, "manifest")
    actual = index(observed, "observed")
    missing = planned.keys() - actual.keys()
    unexpected = actual.keys() - planned.keys()
    switched = {k for k in planned.keys() & actual.keys() if planned[k] != actual[k]}
    return {
        "manifest_assignments": len(planned),
        "observed_assignments": len(actual),
        "missing_assignments": len(missing),
        "unexpected_assignments": len(unexpected),
        "arm_mismatches": len(switched),
        "manifest_matches": bool(planned) and not (missing or unexpected or switched),
        "interpretation": "Assignment completeness only; cannot establish preregistration date, randomization, reviewer blinding, or outcome validity."
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("observed", type=Path)
    args = parser.parse_args()
    def load(path):
        if path.stat().st_size > 1024 * 1024:
            raise ValueError("CSV exceeds 1 MiB limit")
        with path.open(newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    result = verify(load(args.manifest), load(args.observed))
    print(json.dumps(result, indent=2, sort_keys=True))
    if not result["manifest_matches"]:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
