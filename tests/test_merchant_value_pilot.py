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

    def test_assignment_denominators_and_comparison_gate(self):
        out = analyze([
            row(merchant="m1", brief="a", arm="ai", labor="12", useful="1"),
            row(merchant="m1", brief="b", arm="ai", status="abandoned", labor="8", useful="0"),
            row(merchant="m1", brief="c", arm="control", labor="30", useful="1", cost="0"),
            row(merchant="m1", brief="d", arm="control", labor="30", useful="1", cost="0"),
        ])
        self.assertEqual(out["ai"]["completion_rate"], 0.5)
        self.assertEqual(out["ai"]["useful_rate_per_assigned"], 0.5)
        self.assertEqual(out["ai"]["labor_minutes_per_assigned"], 10)
        self.assertTrue(out["accounting_comparison_ready"])

    def test_incomplete_or_single_arm_cannot_compare(self):
        self.assertFalse(analyze([row()])["accounting_comparison_ready"])
        out = analyze([row(), row(brief="b2", arm="control", labor="")])
        self.assertFalse(out["accounting_comparison_ready"])
        self.assertIsNone(out["control"]["labor_minutes_per_assigned"])

    def test_disjoint_merchants_do_not_qualify_for_comparison(self):
        out = analyze([
            row(merchant="merchant_a", brief="a", arm="ai"),
            row(merchant="merchant_b", brief="b", arm="control"),
        ])
        self.assertEqual(out["merchants_total"], 2)
        self.assertEqual(out["merchants_with_both_arms"], 0)
        self.assertFalse(out["accounting_comparison_ready"])

    def test_partial_merchant_crossover_does_not_qualify(self):
        out = analyze([
            row(merchant="m1", brief="a", arm="ai"),
            row(merchant="m1", brief="b", arm="control"),
            row(merchant="m2", brief="c", arm="ai"),
        ])
        self.assertEqual(out["merchants_with_both_arms"], 1)
        self.assertFalse(out["accounting_comparison_ready"])

    def test_unequal_within_merchant_assignments_block_comparison(self):
        out = analyze([
            row(merchant="m1", brief="a", arm="ai"),
            row(merchant="m1", brief="b", arm="ai"),
            row(merchant="m1", brief="c", arm="control"),
        ])
        self.assertEqual(out["merchants_with_both_arms"], 1)
        self.assertEqual(out["merchants_with_balanced_arms"], 0)
        self.assertFalse(out["accounting_comparison_ready"])

    def test_balanced_assignments_across_merchants(self):
        out = analyze([
            row(merchant="m1", brief="a", arm="ai"),
            row(merchant="m1", brief="b", arm="control"),
            row(merchant="m2", brief="c", arm="ai"),
            row(merchant="m2", brief="d", arm="control"),
        ])
        self.assertEqual(out["merchants_with_balanced_arms"], 2)
        self.assertTrue(out["accounting_comparison_ready"])

    def test_merchant_weighted_difference_not_pooled(self):
        # Merchant one has one pair, merchant two has three pairs.
        # Equal merchant weighting gives (-20 + 10) / 2 = -5.
        records = [
            row(merchant="m1", brief="a", arm="ai", labor="10"),
            row(merchant="m1", brief="b", arm="control", labor="30"),
        ]
        for i in range(3):
            records.append(row(merchant="m2", brief=f"a{i}", arm="ai", labor="30"))
            records.append(row(merchant="m2", brief=f"c{i}", arm="control", labor="20"))
        out = analyze(records)
        self.assertTrue(out["accounting_comparison_ready"])
        self.assertEqual(out["merchant_weighted_labor_difference_minutes_per_assignment"], -5)
        self.assertEqual(out["merchants_with_lower_ai_labor"], 1)

    def test_missing_labor_suppresses_merchant_difference(self):
        out = analyze([
            row(brief="a", arm="ai", labor=""),
            row(brief="b", arm="control", labor="20"),
        ])
        self.assertIsNone(out["merchant_weighted_labor_difference_minutes_per_assignment"])
        self.assertIsNone(out["merchants_with_lower_ai_labor"])

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

    def test_finite_inputs_with_overflowed_total_cost_rejected(self):
        with self.assertRaisesRegex(ValueError, "Nonfinite aggregate"):
            analyze([row(brief="a", cost="1e308"), row(brief="b", cost="1e308")])

    def test_finite_inputs_with_overflowed_total_labor_rejected(self):
        with self.assertRaisesRegex(ValueError, "Nonfinite aggregate"):
            analyze([row(brief="a", labor="1e308"), row(brief="b", labor="1e308")])

    def test_finite_arm_totals_with_overflowed_merchant_difference_rejected(self):
        with self.assertRaisesRegex(ValueError, "Nonfinite merchant labor comparison"):
            analyze([row(brief="a", arm="ai", labor="1e308"),
                     row(brief="b", arm="control", labor="1e308"),
                     row(merchant="m2", brief="c", arm="ai", labor="1e308"),
                     row(merchant="m2", brief="d", arm="control", labor="0")])

    def test_invalid_cost_rejected(self):
        with self.assertRaisesRegex(ValueError, "finite"):
            analyze([row(cost="nan")])

if __name__ == "__main__":
    unittest.main()
