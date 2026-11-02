"""Offline regression tests for unapproved public metadata copy proposals."""
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "public_metadata_proposals", ROOT / "scripts/check-public-metadata-proposals.py"
)
assert spec and spec.loader
checker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = checker
spec.loader.exec_module(checker)


class PublicMetadataProposalsTests(unittest.TestCase):
    def setUp(self):
        self.original = json.loads(checker.DATA.read_text(encoding="utf-8"))

    def check(self, document):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "unapproved.json"
            path.write_text(json.dumps(document), encoding="utf-8")
            return checker.load_and_validate(path)

    def test_all_six_are_bounded_and_unapproved(self):
        records = self.check(self.original)
        self.assertEqual({x["product_slug"] for x in records}, checker.SLUGS)
        self.assertTrue(all(x["status"] == "UNAPPROVED_PUBLIC_RESEARCH" for x in records))
        self.assertTrue(all(x["proposed_length"] < x["original_meta_description_length"] for x in records))

    def test_never_promote_public_data_to_merchant_authorized(self):
        for key in ("merchant_authorized", "modified_store", "seo_performance_improvement_proven"):
            sample = copy.deepcopy(self.original)
            sample[key] = True
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check(sample)

    def test_duplicate_or_external_page_is_rejected(self):
        duplicate = copy.deepcopy(self.original)
        duplicate["proposals"][1]["product_slug"] = duplicate["proposals"][0]["product_slug"]
        with self.assertRaises(ValueError):
            self.check(duplicate)
        external = copy.deepcopy(self.original)
        external["proposals"][0]["url"] = "https://example.com/products/fake"
        with self.assertRaises(ValueError):
            self.check(external)

    def test_unapproved_status_and_source_hash_are_mandatory(self):
        for field, value in (("status", "approved"),
                             ("original_meta_description_sha256", ""),
                             ("original_meta_description_length", 10)):
            sample = copy.deepcopy(self.original)
            sample["proposals"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check(sample)

    def test_draft_length_and_price_unsafe_copy_fail(self):
        for copy_text in (
            "Short.",
            "A" * 165,
            "A brand new cosmetic product guaranteed to work for $19 and make your skin instantly perfect today!"
        ):
            sample = copy.deepcopy(self.original)
            sample["proposals"][0]["proposed_meta_description"] = copy_text
            sample["proposals"][0]["proposed_length"] = len(copy_text)
            with self.subTest(copy_text=copy_text[:25]), self.assertRaises(ValueError):
                self.check(sample)


if __name__ == "__main__":
    unittest.main()
