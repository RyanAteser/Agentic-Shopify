"""Offline validation of the Monika metadata GSC evaluation gate.

All counts in test fixtures are artificial and never used as merchant evidence.
"""
import copy
import importlib.util
import json
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gsc_metadata_impact_gate", ROOT / "scripts/gsc-metadata-impact-gate.py")
assert spec and spec.loader
gate = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = gate
spec.loader.exec_module(gate)
PLANNING = gate.plan()
CHANGE_DATE = date(2026, 9, 1)
START = CHANGE_DATE - timedelta(days=14)
END = CHANGE_DATE + timedelta(days=14)


def fixture():
    """Purely artificial test fixture, not a real Search Console export."""
    treat = PLANNING["allocation"]["treatmentUrls"]
    control = PLANNING["allocation"]["delayedControlUrls"]
    rows = []
    for day_offset in range(-14, 15):
        day = CHANGE_DATE + timedelta(days=day_offset)
        for url in treat + control:
            control_arm = url in control
            if day_offset == 0:
                clicks = 0
            elif day_offset < 0:
                clicks = 2
            else:
                clicks = 2 if control_arm else 3
            rows.append({
                "keys": [day.isoformat(), url],
                "clicks": clicks,
                "impressions": 20,
            })
    return {
        "studyId": gate.STUDY,
        "authorization": {
            "merchantConsented": True,
            "propertyVerified": True,
            "permissionLevel": "siteOwner",
            "siteUrl": PLANNING["property"],
            "consentedAt": "2026-08-01T10:00:00Z",
        },
        "changeLog": {
            "merchantApproved": True,
            "changesApplied": True,
            "controlUnchanged": True,
            "changedAt": "2026-09-01T15:00:00Z",
            "treatmentUrls": treat,
            "controlUrls": control,
        },
        "export": {
            "siteUrl": PLANNING["property"],
            "searchType": "web",
            "dataState": "final",
            "responseAggregationType": "byPage",
            "dimensions": ["date", "page"],
            "pageEqualsFilters": sorted(treat + control),
            "completePagination": True,
            "noAdditionalFilters": True,
            "startDate": START.isoformat(),
            "endDate": END.isoformat(),
            "exportedAt": "2026-10-01T20:00:00Z",
            "rows": rows,
        },
    }


class MetadataGscGateTests(unittest.TestCase):
    def assess(self, x):
        return gate.evaluate(x, PLANNING, now=datetime(2026, 10, 2, tzinfo=timezone.utc))

    def test_plan_is_preregistered_reproducible_and_not_a_result(self):
        self.assertEqual(gate.plan(), PLANNING)
        self.assertEqual(PLANNING["status"], "WITHHELD_NO_AUTHORIZED_INTERVENTION_OR_GSC_DATA")
        self.assertIsNone(PLANNING["outcome"])
        self.assertEqual(len(PLANNING["allocation"]["treatmentUrls"]), 3)
        self.assertEqual(len(PLANNING["allocation"]["delayedControlUrls"]), 3)
        self.assertEqual(
            len(set(PLANNING["allocation"]["treatmentUrls"] +
                    PLANNING["allocation"]["delayedControlUrls"])), 6)

    def test_no_input_is_never_an_effect_estimate(self):
        self.assertEqual(self.assess({})["status"], "withheld")
        self.assertIsNone(self.assess({})["outcome"])

    def test_requires_merchant_consent_and_verified_property(self):
        for field, value in (
            ("merchantConsented", False),
            ("propertyVerified", False),
            ("siteUrl", "https://artemisti.myshopify.com/"),
            ("permissionLevel", "siteRestrictedUser"),
        ):
            x = fixture()
            x["authorization"][field] = value
            with self.subTest(field=field):
                result = self.assess(x)
                self.assertEqual(result["status"], "withheld")
                self.assertEqual(result["reason"], "merchant_consent_and_verified_property_required")

    def test_requires_actual_change_and_fixed_controls(self):
        for field, value in (
            ("merchantApproved", False),
            ("changesApplied", False),
            ("controlUnchanged", False),
            ("controlUrls", []),
        ):
            x = fixture()
            x["changeLog"][field] = value
            with self.subTest(field=field):
                self.assertEqual(self.assess(x)["reason"],
                                 "approved_treatment_and_unchanged_controls_required")

    def test_rejects_fresh_or_unfinalized_gsc_data(self):
        x = fixture()
        x["export"]["exportedAt"] = "2026-09-16T00:00:00Z"
        self.assertEqual(self.assess(x)["reason"], "await_final_gsc_data")
        x = fixture()
        x["export"]["dataState"] = "all"
        self.assertEqual(self.assess(x)["reason"], "gsc_export_scope_or_pagination_invalid")

    def test_rejects_incomplete_mismatched_or_unsafe_gsc_exports(self):
        for tweak in ("missing_row", "duplicate", "cross_store", "bad_clicks",
                      "wrong_property", "truncated", "missing_page_filters",
                      "extra_filters", "changed_date_window"):
            x = fixture()
            if tweak == "missing_row":
                x["export"]["rows"].pop()
            elif tweak == "duplicate":
                x["export"]["rows"].append(x["export"]["rows"][0])
            elif tweak == "cross_store":
                x["export"]["rows"][0]["keys"][1] = "https://artemisti.myshopify.com/products/nope"
            elif tweak == "bad_clicks":
                x["export"]["rows"][0]["clicks"] = 100
            elif tweak == "wrong_property":
                x["export"]["siteUrl"] = "https://artemisti.myshopify.com/"
            elif tweak == "truncated":
                x["export"]["completePagination"] = False
            elif tweak == "missing_page_filters":
                x["export"]["pageEqualsFilters"] = []
            elif tweak == "extra_filters":
                x["export"]["noAdditionalFilters"] = False
            elif tweak == "changed_date_window":
                x["export"]["startDate"] = "2026-07-01"
            with self.subTest(tweak=tweak):
                result = self.assess(x)
                self.assertEqual(result["status"], "withheld")
                self.assertIsNone(result["outcome"])

    def test_low_volume_is_withheld_not_zero_effect(self):
        x = fixture()
        for row in x["export"]["rows"]:
            row["impressions"] = 2
            row["clicks"] = min(row["clicks"], 2)
        result = self.assess(x)
        self.assertEqual(result["reason"], "insufficient_impressions")
        self.assertIsNone(result["outcome"])

    def test_complete_fixture_is_descriptive_not_proven_causal(self):
        x = fixture()
        result = self.assess(x)
        self.assertEqual(result["status"], "descriptive_only")
        self.assertFalse(result["causalImpactProven"])
        self.assertFalse(result["statisticalSignificanceEstablished"])
        self.assertEqual(result["authorization"], "self_attested_not_independently_verified")
        self.assertAlmostEqual(result["differenceInDifferencesPercentagePoints"], 5.0)
        self.assertAlmostEqual(result["pretrendDifferencePercentagePoints"], 0.0)
        self.assertEqual(result["treatment"]["beforeImpressions"], 840)
        self.assertEqual(result["control"]["afterImpressions"], 840)

    def test_missing_entire_change_day_is_allowed_but_not_fabricated(self):
        x = fixture()
        x["export"]["rows"] = [
            row for row in x["export"]["rows"] if row["keys"][0] != CHANGE_DATE.isoformat()
        ]
        self.assertEqual(self.assess(x)["status"], "descriptive_only")

    def test_source_plan_rejects_tenant_import_or_approved_proposals(self):
        manifest = json.loads(gate.PROPOSALS.read_text("utf-8"))
        with __import__("tempfile").TemporaryDirectory() as tmp:
            path = Path(tmp) / "manifest.json"
            for field, value in (
                ("source_host", "artemisti.myshopify.com"),
                ("merchant_authorized", True),
                ("modified_store", True),
            ):
                changed = copy.deepcopy(manifest)
                changed[field] = value
                path.write_text(json.dumps(changed), encoding="utf-8")
                with self.subTest(field=field), self.assertRaises(ValueError):
                    gate.plan(path)


if __name__ == "__main__":
    unittest.main()
