import unittest
from scripts.pilot_pair_estimator import summarize


def pair(merchant, name, ai, manual):
    return [
        dict(merchant_id=merchant, pair_id=name, arm=arm,
             active_minutes="" if value is None else str(value))
        for arm, value in (("ai", ai), ("manual", manual))
    ]


class PilotPairEstimatorTests(unittest.TestCase):
    def test_paired_percentages_not_group_medians(self):
        result = summarize(pair("a", "1", 5, 10) + pair("a", "2", 90, 100))
        self.assertEqual(result["median_percent_saved"], 30)
        self.assertEqual(result["median_minutes_saved"], 7.5)

    def test_missing_not_zero(self):
        result = summarize(pair("a", "1", None, 10) + pair("a", "2", 8, 10))
        self.assertEqual(result["complete_pairs"], 1)
        self.assertEqual(result["ai_time_coverage"], .5)
        self.assertFalse(result["measurement_gate_pass"])
        self.assertFalse(result["feasibility_percent_gate_pass"])

    def test_zero_manual_kept_in_absolute_accounting(self):
        result = summarize(pair("a", "1", 2, 0) + pair("a", "2", 4, 10))
        self.assertEqual(result["zero_manual_pairs"], 1)
        self.assertEqual(result["median_minutes_saved"], 2)
        self.assertEqual(result["median_percent_saved"], 60)

    def test_merchant_strata(self):
        result = summarize(pair("a", "1", 5, 10) + pair("b", "1", 10, 10))
        self.assertEqual(result["merchant_strata"]["a"]["median_percent_saved"], 50)
        self.assertEqual(result["merchant_strata"]["b"]["median_percent_saved"], 0)

    def test_disjoint_missingness_does_not_pass_complete_pair_gate(self):
        rows = []
        for i in range(10):
            rows += pair("a", str(i), None if i < 2 else 5,
                         None if 2 <= i < 4 else 10)
        result = summarize(rows)
        self.assertEqual(result["ai_time_coverage"], .8)
        self.assertEqual(result["manual_time_coverage"], .8)
        self.assertEqual(result["complete_pair_coverage"], .6)
        self.assertFalse(result["measurement_gate_pass"])

    def test_small_sample_cannot_pass_feasibility_gate(self):
        result = summarize(pair("a", "1", 1, 10))
        self.assertTrue(result["measurement_gate_pass"])
        self.assertFalse(result["feasibility_percent_gate_pass"])

    def test_twenty_complete_pairs_can_pass_narrow_feasibility_gate(self):
        rows = []
        for i in range(20):
            rows += pair("a", str(i), 5, 10)
        result = summarize(rows)
        self.assertTrue(result["feasibility_percent_gate_pass"])

    def test_missing_pair_sensitivity_can_block_favorable_complete_cases(self):
        rows = []
        for i in range(20):
            rows += pair("a", str(i), 5 if i < 10 else 9, 10)
        for i in range(5):
            rows += pair("a", f"missing-{i}", None, 10)
        result = summarize(rows)
        self.assertTrue(result["measurement_gate_pass"])
        self.assertEqual(result["median_percent_saved"], 30)
        self.assertEqual(result["missing_pair_zero_savings_scenario_median_percent"], 10)
        self.assertFalse(result["feasibility_percent_gate_pass"])

    def test_missing_pair_sensitivity_is_reported_not_claimed_as_bound(self):
        rows = []
        for i in range(20):
            rows += pair("a", str(i), 5, 10)
        for i in range(5):
            rows += pair("a", f"missing-{i}", None, 10)
        result = summarize(rows)
        self.assertEqual(result["missing_pair_zero_savings_scenario_median_percent"], 50)
        self.assertIn("not a statistical bound", result["missing_pair_zero_savings_scenario_assumption"])

    def test_pooled_savings_cannot_hide_losing_merchant(self):
        rows = []
        for i in range(20):
            rows += pair("large", str(i), 5, 10)
        rows += pair("small", "one", 12, 10)
        result = summarize(rows)
        self.assertEqual(result["merchant_count"], 2)
        self.assertEqual(result["merchants_with_nonpositive_median_percent_saved"], ["small"])
        self.assertEqual(result["merchant_median_percent_saved"], 15)
        self.assertTrue(result["merchant_heterogeneity_review_required"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_single_merchant_requires_external_replication(self):
        rows = []
        for i in range(20):
            rows += pair("only", str(i), 5, 10)
        result = summarize(rows)
        self.assertTrue(result["feasibility_percent_gate_pass"])
        self.assertTrue(result["merchant_heterogeneity_review_required"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_multiple_positive_merchants_clear_heterogeneity_flag(self):
        rows = []
        for merchant in ("a", "b"):
            for i in range(20):
                rows += pair(merchant, str(i), 5, 10)
        result = summarize(rows)
        self.assertFalse(result["merchant_heterogeneity_review_required"])
        self.assertTrue(result["multi_merchant_pilot_gate_pass"])

    def test_unmeasured_merchant_cannot_disappear_from_multi_merchant_gate(self):
        rows = []
        for merchant in ("a", "b"):
            for i in range(20):
                rows += pair(merchant, str(i), 5, 10)
        rows += pair("c", "missing", None, None)
        result = summarize(rows)
        self.assertTrue(result["feasibility_percent_gate_pass"])
        self.assertEqual(result["merchants_without_percent_observations"], ["c"])
        self.assertTrue(result["merchant_heterogeneity_review_required"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_pooled_coverage_cannot_hide_merchant_missingness(self):
        rows = []
        for merchant in ("a", "b"):
            for i in range(20):
                rows += pair(merchant, str(i), 5, 10)
        # Merchant c has 50% complete coverage, while pooled coverage
        # remains above 80%; its single observed pair looks favorable.
        rows += pair("c", "observed", 5, 10)
        rows += pair("c", "missing", None, 10)
        result = summarize(rows)
        self.assertTrue(result["measurement_gate_pass"])
        self.assertTrue(result["feasibility_percent_gate_pass"])
        self.assertEqual(result["merchants_failing_measurement_coverage"], ["c"])
        self.assertTrue(result["merchant_heterogeneity_review_required"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_zero_manual_merchant_requires_review(self):
        rows = []
        for merchant in ("a", "b"):
            for i in range(20):
                rows += pair(merchant, str(i), 5, 10)
        rows += pair("c", "zero", 0, 0)
        result = summarize(rows)
        self.assertEqual(result["merchants_without_percent_observations"], ["c"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_zero_baseline_labor_loss_cannot_hide_behind_positive_percentages(self):
        rows = []
        for merchant in ("a", "b"):
            for i in range(20):
                rows += pair(merchant, str(i), 5, 10)
        # Merchant b's additional task has zero manual time but positive AI time.
        # Percentage median omits it, so the absolute regression must be visible.
        rows += pair("b", "zero-baseline-loss", 4, 0)
        result = summarize(rows)
        self.assertTrue(result["feasibility_percent_gate_pass"])
        self.assertEqual(result["merchant_strata"]["b"]["zero_manual_ai_labor_loss_pairs"], 1)
        self.assertEqual(result["merchants_with_zero_manual_ai_labor_losses"], ["b"])
        self.assertTrue(result["merchant_heterogeneity_review_required"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_zero_baseline_without_ai_labor_does_not_trigger_loss_flag(self):
        rows = []
        for merchant in ("a", "b"):
            for i in range(20):
                rows += pair(merchant, str(i), 5, 10)
        rows += pair("b", "zero-both", 0, 0)
        result = summarize(rows)
        self.assertEqual(result["merchants_with_zero_manual_ai_labor_losses"], [])
        self.assertTrue(result["multi_merchant_pilot_gate_pass"])

    def test_merchant_with_one_favorable_pair_cannot_pass_replication_floor(self):
        rows = []
        for i in range(25):
            rows += pair("large", str(i), 5, 10)
        rows += pair("tiny", "only", 5, 10)
        result = summarize(rows)
        self.assertTrue(result["feasibility_percent_gate_pass"])
        self.assertEqual(result["merchants_below_replication_floor"], ["tiny"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_five_eligible_pairs_each_clear_replication_floor(self):
        rows = []
        for merchant in ("a", "b"):
            for i in range(10):
                rows += pair(merchant, str(i), 5, 10)
        result = summarize(rows)
        self.assertEqual(result["merchants_below_replication_floor"], [])
        self.assertTrue(result["multi_merchant_pilot_gate_pass"])

    def test_pooled_target_cannot_hide_low_savings_merchant(self):
        rows = []
        for i in range(20):
            rows += pair("strong", str(i), 5, 10)
        for i in range(5):
            rows += pair("weak", str(i), 9, 10)
        result = summarize(rows)
        self.assertTrue(result["feasibility_percent_gate_pass"])
        self.assertEqual(result["merchants_below_sensitivity_savings_target"], ["weak"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_merchant_missingness_sensitivity_can_fail_despite_positive_observed_median(self):
        rows = []
        for i in range(20):
            rows += pair("strong", str(i), 5, 10)
        for i in range(8):
            rows += pair("fragile", str(i), 5 if i < 4 else 9, 10)
        for i in range(2):
            rows += pair("fragile", f"missing-{i}", None, 10)
        result = summarize(rows)
        self.assertTrue(result["measurement_gate_pass"])
        self.assertEqual(result["merchant_strata"]["fragile"]["median_percent_saved"], 30)
        self.assertEqual(result["merchant_strata"]["fragile"]["missing_pair_zero_savings_scenario_median_percent"], 10)
        self.assertEqual(result["merchants_below_sensitivity_savings_target"], ["fragile"])
        self.assertFalse(result["multi_merchant_pilot_gate_pass"])

    def test_duplicate_rejected(self):
        with self.assertRaises(ValueError):
            summarize(pair("a", "1", 5, 10) + pair("a", "1", 4, 10))

    def test_nonfinite_rejected(self):
        with self.assertRaises(ValueError):
            summarize(pair("a", "1", "nan", 10))

    def test_unpaired_rejected(self):
        with self.assertRaises(ValueError):
            summarize(pair("a", "1", 5, 10)[:1])


if __name__ == "__main__":
    unittest.main()
