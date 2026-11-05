import assert from "node:assert/strict";
import test from "node:test";
import { runObservedCatalogRead } from "../app/lib/catalog-read-runner";

test("successful catalog audit remains successful when telemetry sink throws", async () => {
  let emitted = 0;
  const result = await runObservedCatalogRead({
    primaryDomain: async () => "store.example",
    catalogPage: async () => [],
    audit: () => ({ eligible: 0 }),
  }, () => {
    emitted += 1;
    throw new Error("logging transport unavailable");
  });
  assert.deepEqual(result, { ok: true, value: { eligible: 0 } });
  assert.equal(emitted, 1);
});

test("failed catalog read remains safely unavailable when telemetry sink throws", async () => {
  let emitted = 0;
  let catalogCalled = false;
  const result = await runObservedCatalogRead({
    primaryDomain: async (): Promise<string> => { throw new Error("private provider payload"); },
    catalogPage: async () => { catalogCalled = true; return []; },
    audit: () => ({ eligible: 0 }),
  }, () => {
    emitted += 1;
    throw new Error("logging transport unavailable");
  });
  assert.deepEqual(result, { ok: false });
  assert.equal(emitted, 1);
  assert.equal(catalogCalled, false);
});
