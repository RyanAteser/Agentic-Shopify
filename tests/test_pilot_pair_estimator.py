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
