import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
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
  assert.deepEqual(new Set(Object.values(filters).map(where => where.status)),
    new Set(["queued", "running", "dispatch_uncertain"]));
  assert.equal(filters.uncertainDelivery.status, "dispatch_uncertain");
  assert.equal(filters.manualQueued.outboxVersion.not, 1);
});

test("SQLite/PostgreSQL triage counts exclude fresh, failed and completed jobs", async () => {
  const now = new Date("2026-10-30T02:00:00.000Z");
  const shop = "reconcile-" + randomUUID() + ".myshopify.com";
  const old = new Date("2026-10-30T01:00:00.000Z");
  const recent = new Date("2026-10-30T01:59:00.000Z");
  const data = [
    { shop, topic: "Fixture", status: "queued", outboxVersion: 1, createdAt: old },
    { shop, topic: "Fixture", status: "queued", outboxVersion: 1, createdAt: recent },
    { shop, topic: "Fixture", status: "queued", outboxVersion: 0, createdAt: old },
    { shop, topic: "Fixture", status: "queued", outboxVersion: 2, createdAt: old },
    { shop, topic: "Fixture", status: "running", updatedAt: old },
    { shop, topic: "Fixture", status: "running", updatedAt: recent },
    { shop, topic: "Fixture", status: "dispatch_uncertain", updatedAt: recent },
    { shop, topic: "Fixture", status: "completed", updatedAt: old },
    { shop, topic: "Fixture", status: "failed", updatedAt: old },
  ];
  await db.contentJob.createMany({ data });
  try {
    const filters = generationReconciliationFilters(now, 5 * 60_000);
    const counts = await Promise.all([
      db.contentJob.count({ where: { AND: [filters.recoverableQueued, { shop }] } }),
      db.contentJob.count({ where: { AND: [filters.manualQueued, { shop }] } }),
      db.contentJob.count({ where: { AND: [filters.staleRunning, { shop }] } }),
      db.contentJob.count({ where: { AND: [filters.uncertainDelivery, { shop }] } }),
    ]);
    assert.deepEqual(counts, [1, 2, 1, 1]);
  } finally {
    await db.contentJob.deleteMany({ where: { shop } });
  }
});
