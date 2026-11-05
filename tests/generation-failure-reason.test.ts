import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { safeGenerationFailureReason } from "../app/lib/generation-failure-reason";
import { ProductContextUnavailableError } from "../app/lib/product-context.server";
import { createCreditedJob, failCreditedJob } from "../app/lib/credits.server";
import { claimDueScheduledDraft, failScheduledDraft } from "../app/lib/scheduled-drafts.server";

const due = new Date("2026-10-28T18:00:00.000Z");
const now = new Date("2026-10-28T20:00:00.000Z");
const secret = "synthetic-secret-not-a-real-key";
const sensitive = "https://merchant.example/private?token=" + secret;

test("failure categories are fixed, useful and cannot echo arbitrary upstream details", () => {
  assert.match(safeGenerationFailureReason(new ProductContextUnavailableError()), /product context unavailable/i);
  assert.equal(safeGenerationFailureReason(new Error("n8n integration is not configured")),
    "n8n generation integration is not configured.");
  assert.equal(safeGenerationFailureReason(new Error("Select a Shopify blog first")),
    "No Shopify destination blog selected.");
  assert.equal(safeGenerationFailureReason(new Error("n8n rejected generation request (HTTP 422)")),
    "Generation failed before confirmed acceptance; operator review required.");
  for (const error of [
    new Error("Prisma failed on " + sensitive),
    new Error("n8n rejected generation request (HTTP 400) " + sensitive),
    { toString() { throw new Error("must not stringify arbitrary objects"); } },
    sensitive, null
  ]) {
    const result = safeGenerationFailureReason(error);
    assert.equal(result, "Generation failed before confirmed acceptance; operator review required.");
    assert.doesNotMatch(result, /merchant\.example|synthetic-secret|token=/);
  }
});

test("manual and scheduled refund records never retain upstream merchant URLs or tokens", async () => {
  const shop = "failure-privacy-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({ data: {
    shop, enabled: true, blogId: "gid://shopify/Blog/1",
    seedTopics: "Care guide", nextRunAt: due
  } });
  try {
    const manual = await createCreditedJob(shop, "Manual topic");
    assert.equal(await failCreditedJob(shop, manual.id,
      new Error("Shopify response: " + sensitive)), true);
    const manualRow = await db.contentJob.findUniqueOrThrow({ where: { id: manual.id } });
    assert.equal(manualRow.status, "failed");
    assert.equal(manualRow.error, "Generation failed before confirmed acceptance; operator review required.");

    const snapshot = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    const scheduled = await claimDueScheduledDraft(snapshot, now);
    assert.ok(scheduled);
    assert.equal(await failScheduledDraft(scheduled,
      new Error("Prisma failure: " + sensitive)), true);
    const scheduledRow = await db.contentJob.findUniqueOrThrow({ where: { id: scheduled.jobId } });
    assert.equal(scheduledRow.status, "failed");
    assert.equal(scheduledRow.error, manualRow.error);
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 0);
  } finally {
    await db.contentJob.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
});
