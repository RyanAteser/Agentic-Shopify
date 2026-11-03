import unittest
from scripts.pilot_cost_estimator import summarize_costs


def row(merchant, pair, manual="10", ai="5", provider="0.10", rate="60"):
    return dict(merchant_id=merchant, pair_id=pair, manual_minutes=manual,
                ai_minutes=ai, ai_provider_usd=provider, hourly_labor_usd=rate)


class PilotCostTests(unittest.TestCase):
    def test_provider_cost_can_reverse_labor_savings(self):
        result = summarize_costs([row("a", "1", provider="8")])
        self.assertEqual(result["observed_net_usd_saved"], -3)
        self.assertFalse(result["all_merchants_observed_net_positive"])

    def test_missing_provider_cost_is_not_zero(self):
        result = summarize_costs([row("a", "1", provider="")])
        self.assertEqual(result["complete_cost_pairs"], 0)
        self.assertFalse(result["all_merchants_observed_net_positive"])

    def test_pooled_gain_cannot_hide_losing_merchant(self):
        result = summarize_costs([row("a", "1"), row("b", "1", provider="8")])
        self.assertFalse(result["all_merchants_observed_net_positive"])
        self.assertLess(result["merchant_strata"]["b"]["observed_net_usd_saved"], 0)

    def test_positive_complete_merchants(self):
        result = summarize_costs([row("a", "1"), row("b", "1")])
        self.assertTrue(result["all_merchants_observed_net_positive"])
        self.assertFalse(result["launch_or_revenue_claim_supported"])

    def test_positive_observed_but_negative_under_cost_overrun(self):
        result = summarize_costs([row("a", "1", manual="10", ai="8", provider="0.5")])
        self.assertAlmostEqual(result["observed_net_usd_saved"], 1.5)
        self.assertAlmostEqual(result["stressed_net_usd_saved"], -0.625)
        self.assertTrue(result["all_merchants_observed_net_positive"])
        self.assertFalse(result["all_merchants_stressed_net_positive"])

    def test_stress_pass_requires_every_merchant_complete(self):
        result = summarize_costs([row("a", "1", manual="20", ai="5"),
                                  row("b", "1", provider="")])
        self.assertFalse(result["all_merchants_stressed_net_positive"])

    def test_strong_savings_survive_stress(self):
        result = summarize_costs([row("a", "1", manual="20", ai="5"),
                                  row("b", "1", manual="20", ai="5")])
        self.assertTrue(result["all_merchants_stressed_net_positive"])

    def test_fixed_overhead_reverses_variable_savings(self):
        result = summarize_costs([row("a", "1", manual="20", ai="5")], {"a": 20})
        self.assertTrue(result["all_merchants_stressed_net_positive"])
        self.assertFalse(result["all_merchants_net_after_fixed_positive"])
        self.assertLess(result["merchant_strata"]["a"]["net_after_fixed_usd"], 0)

    def test_no_fixed_cost_evidence_does_not_pass_fixed_gate(self):
        result = summarize_costs([row("a", "1", manual="20", ai="5")])
        self.assertIsNone(result["merchant_strata"]["a"]["net_after_fixed_usd"])
        self.assertFalse(result["all_merchants_net_after_fixed_positive"])

    def test_fixed_costs_require_exact_merchant_coverage(self):
        for costs in ({}, {"a": 0, "b": 0}, {"a": -1}, {"a": float("inf")}, {"a": True}):
            with self.subTest(costs=costs), self.assertRaises(ValueError):
                summarize_costs([row("a", "1")], costs)

    def test_zero_fixed_cost_still_requires_complete_pairs(self):
        result = summarize_costs([row("a", "1"), row("a", "2", provider="")], {"a": 0})
        self.assertFalse(result["all_merchants_net_after_fixed_positive"])

    def test_schema_drift_and_extra_csv_fields_fail_closed(self):
        valid = row("a", "1")
        for malformed in (
            {**valid, "ai_provder_usd": "0.1"},
            {key: value for key, value in valid.items() if key != "ai_provider_usd"},
            {**valid, None: ["unexpected", "column"]},
            {**valid, "ai_minutes": None},
        ):
            with self.subTest(malformed=malformed), self.assertRaises(ValueError):
                summarize_costs([malformed])

    def test_duplicate_csv_header_is_rejected(self):
        import subprocess
        import sys
        import tempfile
        from pathlib import Path
        script = Path(__file__).resolve().parents[1] / "scripts" / "pilot_cost_estimator.py"
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "pilot.csv"
            csv_path.write_text("merchant_id,pair_id,manual_minutes,ai_minutes,ai_provider_usd,ai_provider_usd\\na,1,10,5,0.1,0.1\\n", encoding="utf-8")
            result = subprocess.run([sys.executable, str(script), str(csv_path)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unique required columns", result.stderr)

    def test_duplicate_pair_rejected(self):
        with self.assertRaises(ValueError):
            summarize_costs([row("a", "1"), row("a", "1")])

    def test_nonfinite_rejected(self):
        with self.assertRaises(ValueError):
            summarize_costs([row("a", "1", provider="inf")])


if __name__ == "__main__":
    unittest.main()
