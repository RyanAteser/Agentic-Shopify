"""Offline regression tests for preregistered assignment reconciliation."""
import unittest
from tools.merchant_pilot_manifest import verify

def r(m="m1", b="b1", a="ai"):
    return {"merchant_id": m, "brief_id": b, "arm": a}

class ManifestTests(unittest.TestCase):
    def test_exact_match(self):
        self.assertTrue(verify([r(), r(b="b2", a="control")], [r(b="b2", a="control"), r()])["manifest_matches"])
    def test_missing_failed_assignment(self):
        result = verify([r(), r(b="b2", a="control")], [r()])
        self.assertEqual(result["missing_assignments"], 1)
        self.assertFalse(result["manifest_matches"])
    def test_unplanned_assignment(self):
        self.assertEqual(verify([r()], [r(), r(b="b3")])["unexpected_assignments"], 1)
    def test_arm_switched(self):
        result = verify([r()], [r(a="control")])
        self.assertEqual(result["arm_mismatches"], 1)
        self.assertFalse(result["manifest_matches"])
    def test_duplicate_and_invalid(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            verify([r(), r()], [r()])
        with self.assertRaisesRegex(ValueError, "invalid"):
            verify([r(a="other")], [r()])
    def test_empty_cannot_pass(self):
        self.assertFalse(verify([], [])["manifest_matches"])

if __name__ == "__main__":
    unittest.main()
