import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generationReconciliationFilters, GENERATION_RUNNING_STALE_MS
} from "../app/lib/generation-reconciliation";

test("reconciliation filters use exact 5-minute queued and 30-minute running boundaries", () => {
  const now = new Date("2026-10-30T02:00:00.000Z");
  const filters = generationReconciliationFilters(now, 5 * 60_000);
  assert.deepEqual(filters.recoverableQueued, {
    status: "queued", outboxVersion: 1,
    createdAt: { lte: new Date("2026-10-30T01:55:00.000Z") }
  });
  assert.deepEqual(filters.manualQueued, {
    status: "queued", outboxVersion: { not: 1 }
  });
  assert.deepEqual(filters.staleRunning, {
    status: "running", updatedAt: { lte: new Date("2026-10-30T01:30:00.000Z") }
  });
  assert.deepEqual(filters.uncertainDelivery, { status: "dispatch_uncertain" });
  assert.equal(GENERATION_RUNNING_STALE_MS, 30 * 60_000);
});

test("reconciliation rejects invalid clocks and age configuration", () => {
  for (const date of [new Date(NaN), new Date(Infinity)]) {
    assert.throws(() => generationReconciliationFilters(date, 300000));
  }
  for (const age of [-1, NaN, Infinity, 1.5]) {
    assert.throws(() => generationReconciliationFilters(new Date(), age));
  }
});

test("filters never include completed/failed jobs or classify age as proof of rejection", () => {
  const filters = generationReconciliationFilters(new Date("2026-10-30T02:00:00Z"), 300000);
  assert.ok(Object.values(filters).every(where =>
    where.status !== "completed" && where.status !== "failed"
  ));
  assert.equal(filters.uncertainDelivery.status, "dispatch_uncertain");
  assert.equal(filters.manualQueued.outboxVersion.not, 1);
});
