import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { createCreditedJob, failCreditedJob } from "../app/lib/credits.server";

test("free plan permits only 3 lifetime drafts and refunds failed dispatch once", async () => {
  const shop = "test-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({ data: { shop, blogId: "gid://shopify/Blog/1" } });
  try {
    // SQLite dev uses a single-writer DB; production concurrency is tested on Postgres.
    const jobs = [
      await createCreditedJob(shop, "Guide for a merchant A"),
      await createCreditedJob(shop, "Guide for a merchant B"),
      await createCreditedJob(shop, "Guide for a merchant C"),
    ];
    assert.equal(jobs.length, 3);
    await assert.rejects(createCreditedJob(shop, "Fourth generation"), /Free generation limit/);
    const refunded = await failCreditedJob(shop, jobs[0].id, "n8n not reachable");
    const duplicate = await failCreditedJob(shop, jobs[0].id, "n8n not reachable");
    assert.equal(refunded, true);
    assert.equal(duplicate, false);
    const replacement = await createCreditedJob(shop, "Replacement guide");
    assert.ok(replacement.id);
    await assert.rejects(createCreditedJob(shop, "Fifth generation"), /Free generation limit/);
    const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(config.freeDraftsUsed, 3);
  } finally {
    await db.contentJob.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
    await db.$disconnect();
  }
});
