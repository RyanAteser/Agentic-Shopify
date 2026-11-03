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

    def test_duplicate_pair_rejected(self):
        with self.assertRaises(ValueError):
            summarize_costs([row("a", "1"), row("a", "1")])

    def test_nonfinite_rejected(self):
        with self.assertRaises(ValueError):
            summarize_costs([row("a", "1", provider="inf")])


if __name__ == "__main__":
    unittest.main()
