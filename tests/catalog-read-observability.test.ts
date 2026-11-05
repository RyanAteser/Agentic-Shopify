import assert from "node:assert/strict";
import test from "node:test";
import { catalogReadEvent } from "../app/lib/catalog-read-observability";

test("catalog read telemetry is structured and low cardinality", () => {
  assert.deepEqual(JSON.parse(catalogReadEvent("failure", "primary_domain")), {
    event: "catalog_read", outcome: "failure", stage: "primary_domain", version: 1,
  });
  assert.deepEqual(JSON.parse(catalogReadEvent("failure", "catalog_page")).stage, "catalog_page");
  assert.deepEqual(JSON.parse(catalogReadEvent("success", "audit")).outcome, "success");
  for (const outcome of ["success", "failure"] as const) {
    for (const stage of ["primary_domain", "catalog_page", "audit"] as const) {
      const event = catalogReadEvent(outcome, stage);
      assert.deepEqual(Object.keys(JSON.parse(event)).sort(), ["event", "outcome", "stage", "version"]);
      assert.equal(event.includes("shop"), false);
      assert.equal(event.includes("token"), false);
    }
  }
});
