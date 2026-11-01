# Combined merchant pilot decision gate

The standalone labor evaluator is **descriptive only** and can mark an apparently balanced export as accounting-ready even if both sides of an assignment pair were omitted. Do not use its readiness field alone for pilot decisions.

Use the combined, read-only gate:

```bash
python3 -m unittest discover -s tests -p 'test_merchant*.py' -v
python3 tools/merchant_pilot_gate.py frozen-manifest.csv observed-assignments.csv > pilot-report.json
```

The manifest requires `merchant_id,brief_id,arm`. The observed CSV additionally requires `status,labor_minutes,useful,provider_cost_usd`. Both use pseudonymous identifiers. A successful exit requires exact manifest reconciliation, balanced AI/control assignments for each merchant, and complete labor observations. On failure the tool exits 1 and suppresses the paired labor estimate; inspect the JSON report for missing, extra or switched assignments and coverage problems. Do not discard failures or reconstruct missing records as zeros.

**Limits:** Passing this gate does not prove the manifest was frozen before assignment, randomization, topic comparability, honest time logging, editorial quality, statistical significance, causality or merchant growth. Keep the manifest hash and preregistration evidence separately, do not commit merchant CSVs, and require independent editorial review plus a consented pilot before making performance claims. This tool never accesses Shopify, n8n or customer records.
