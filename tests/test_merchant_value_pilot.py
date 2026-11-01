"""Regression checks for merchant pilot accounting; no external dependencies."""
import unittest
from tools.merchant_value_pilot import analyze

def row(merchant="m1", brief="b1", arm="ai", status="completed", labor="10", useful="1", cost="0.50"):
    return dict(merchant_id=merchant, brief_id=brief, arm=arm, status=status,
                labor_minutes=labor, useful=useful, provider_cost_usd=cost)

class PilotAccountingTests(unittest.TestCase):
    def test_complete_assignments(self):
        out = analyze([row(), row(brief="b2", status="failed", labor="5", useful="0", cost="0.20")])
        self.assertEqual(out["ai"]["assigned"], 2)
        self.assertEqual(out["ai"]["useful"], 1)
        self.assertEqual(out["ai"]["labor_minutes_per_useful"], 15)
        self.assertEqual(out["ai"]["provider_cost_per_useful_usd"], 0.7)

    def test_missing_labor_not_zero(self):
        out = analyze([row(), row(brief="b2", labor="", useful="0")])
        self.assertEqual(out["ai"]["labor_coverage"], 0.5)
        self.assertIsNone(out["ai"]["labor_minutes_per_useful"])

    def test_zero_useful_denominator(self):
        out = analyze([row(useful="0")])
        self.assertIsNone(out["ai"]["labor_minutes_per_useful"])
        self.assertIsNone(out["ai"]["provider_cost_per_useful_usd"])

    def test_duplicate_assignment_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            analyze([row(), row(arm="control")])

    def test_failed_cannot_be_useful(self):
        with self.assertRaisesRegex(ValueError, "Noncompleted"):
            analyze([row(status="failed")])

    def test_invalid_cost_rejected(self):
        with self.assertRaisesRegex(ValueError, "finite"):
            analyze([row(cost="nan")])

if __name__ == "__main__":
    unittest.main()
