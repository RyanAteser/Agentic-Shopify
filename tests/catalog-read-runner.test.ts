import test from "node:test";
import assert from "node:assert/strict";
import { runObservedCatalogRead } from "../app/lib/catalog-read-runner";

type Stage = "primary_domain" | "catalog_page" | "audit";
for (const failedStage of ["primary_domain", "catalog_page", "audit"] as Stage[]) {
  test(`catalog failure at ${failedStage} emits exactly one redacted warning`, async () => {
    const events: { level: string; event: string }[] = [];
    const secret = "secret-shop-token-should-never-appear";
    const fail = () => { throw new Error(secret); };
    const result = await runObservedCatalogRead({
      primaryDomain: async () => failedStage === "primary_domain" ? fail() : "example.com",
      catalogPage: async () => failedStage === "catalog_page" ? fail() : { products: [] },
      audit: () => failedStage === "audit" ? fail() : { findings: [] },
    }, (level, event) => events.push({ level, event }));
    assert.deepEqual(result, { ok: false });
    assert.equal(events.length, 1);
    assert.equal(events[0].level, "warn");
    assert.deepEqual(JSON.parse(events[0].event), {
      event: "catalog_read", outcome: "failure", stage: failedStage, version: 1,
    });
    assert.equal(JSON.stringify(events).includes(secret), false);
  });
}

test("successful empty catalog is not misclassified as unavailable", async () => {
  const events: string[] = [];
  const result = await runObservedCatalogRead({
    primaryDomain: async () => "example.com",
    catalogPage: async () => ({ products: [] }),
    audit: (_domain, catalog) => ({ sampled: catalog.products.length, findings: [] }),
  }, (_level, event) => events.push(event));
  assert.deepEqual(result, { ok: true, value: { sampled: 0, findings: [] } });
  assert.equal(events.length, 1);
  assert.deepEqual(JSON.parse(events[0]), {
    event: "catalog_read", outcome: "success", stage: "audit", version: 1,
  });
});
