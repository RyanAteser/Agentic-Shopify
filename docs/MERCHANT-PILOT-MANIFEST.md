# Pilot assignment-manifest reconciliation

The merchant pilot's arm-balance accounting can pass even if an entire AI/control pair is silently omitted from the observed CSV. A frozen assignment sheet is needed to detect selective omissions before interpreting labor savings.

Run `python3 -m unittest discover -s tests -p 'test_merchant_pilot_manifest.py'` and `python3 tools/merchant_pilot_manifest.py frozen-manifest.csv observed-assignments.csv`. Both files require `merchant_id,brief_id,arm`; the observed file may contain the other fields required by `tools/merchant_value_pilot.py`. Include **all** randomized assignments in the manifest, even if abandoned or never started. The checker rejects duplicate IDs, unknown arms, switched arms, extra and missing assignments. A mismatch exits nonzero. Files are capped at 1 MiB each.

Freeze and retain the pseudonymous manifest with a separately recorded timestamp/hash before assignments begin. This checker **cannot verify** that the manifest was frozen in advance, that assignments were randomized, or that a merchant's labor and quality measurements are genuine. Do not commit either CSV, buyer information or article bodies. Require both manifest reconciliation and the existing accounting/independent editorial gates before comparing outcomes. No stores or external services are accessed.
