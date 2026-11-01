"""Fail-closed CSV ingestion regression tests; no external data."""
import tempfile
import unittest
from pathlib import Path
from tools.merchant_pilot_manifest import load_csv, KEYS

class CsvIntegrityTests(unittest.TestCase):
    def check(self, content):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pilot.csv"
            path.write_text(content, encoding="utf-8")
            return load_csv(path, KEYS)

    def test_valid_export(self):
        self.assertEqual(self.check("merchant_id,brief_id,arm\nm1,b1,ai\n")[0]["brief_id"], "b1")

    def test_duplicate_header_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.check("merchant_id,brief_id,arm,arm\nm1,b1,ai,control\n")

    def test_missing_header_rejected(self):
        with self.assertRaisesRegex(ValueError, "required"):
            self.check("merchant_id,brief_id\nm1,b1\n")

    def test_extra_field_rejected(self):
        with self.assertRaisesRegex(ValueError, "malformed"):
            self.check("merchant_id,brief_id,arm\nm1,b1,ai,unexpected\n")

    def test_short_row_rejected(self):
        with self.assertRaisesRegex(ValueError, "malformed"):
            self.check("merchant_id,brief_id,arm\nm1,b1\n")

    def test_unterminated_quote_rejected(self):
        with self.assertRaises(Exception):
            self.check('merchant_id,brief_id,arm\nm1,"b1,ai\n')

if __name__ == "__main__":
    unittest.main()
