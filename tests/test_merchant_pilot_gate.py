"""Regression checks for the combined pilot decision gate."""
import unittest

from tools.merchant_pilot_gate import evaluate


def row(merchant, brief, arm, minutes):
    return {
        "merchant_id": merchant, "brief_id": brief, "arm": arm,
        "status": "completed", "labor_minutes": str(minutes),
        "useful": "1", "provider_cost_usd": "0.01",
    }


class PilotGateTests(unittest.TestCase):
    def setUp(self):
        self.observed = [
            row("m1", "a", "ai", 4),
            row("m1", "b", "control", 10),
        ]
        self.manifest = [
            {"merchant_id": r["merchant_id"], "brief_id": r["brief_id"], "arm": r["arm"]}
            for r in self.observed
        ]

    def test_reconciled_balanced_complete_allows_descriptive_comparison(self):
        result = evaluate(self.manifest, self.observed)
        self.assertTrue(result["comparison_ready"])
        self.assertEqual(
            result["accounting"]["merchant_weighted_labor_difference_minutes_per_assignment"], -6
        )

    def test_missing_balanced_pair_suppresses_estimate(self):
        manifest = self.manifest + [
            {"merchant_id": "m1", "brief_id": "c", "arm": "ai"},
            {"merchant_id": "m1", "brief_id": "d", "arm": "control"},
        ]
        result = evaluate(manifest, self.observed)
        self.assertFalse(result["comparison_ready"])
        self.assertEqual(result["reconciliation"]["missing_assignments"], 2)
        self.assertIsNone(
            result["accounting"]["merchant_weighted_labor_difference_minutes_per_assignment"]
        )

    def test_switched_arm_suppresses_estimate(self):
        manifest = [dict(r) for r in self.manifest]
        manifest[0]["arm"] = "control"
        result = evaluate(manifest, self.observed)
        self.assertFalse(result["comparison_ready"])
        self.assertEqual(result["reconciliation"]["arm_mismatches"], 1)

    def test_incomplete_labor_suppresses_estimate(self):
        observed = [dict(r) for r in self.observed]
        observed[0]["labor_minutes"] = ""
        result = evaluate(self.manifest, observed)
        self.assertFalse(result["comparison_ready"])
        self.assertIsNone(
            result["accounting"]["merchant_weighted_labor_difference_minutes_per_assignment"]
        )


if __name__ == "__main__":
    unittest.main()
