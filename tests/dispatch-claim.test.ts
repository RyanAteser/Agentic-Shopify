import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { claimQueuedDispatch, DispatchAlreadyClaimedError, validateN8nWebhookUrl } from "../app/lib/dispatch-claim.server";

test("n8n webhook URL cannot disguise a remote host as localhost", () => {
  for (const valid of [
    "https://n8n.example.com/webhook/blog",
    "http://localhost:5678/webhook/blog",
    "http://127.0.0.1:5678/webhook/blog",
  ]) assert.doesNotThrow(() => validateN8nWebhookUrl(valid));
  for (const invalid of [
    "http://localhost.evil.example/webhook",
    "http://localhost@evil.example/webhook",
    "http://remote.example/webhook",
    "https://user:password@n8n.example.com/webhook",
    "https://n8n.example.com/webhook#secret",
    "not-a-url",
  ]) assert.throws(() => validateN8nWebhookUrl(invalid), invalid);
});

test("queued job is claimed only once; other shops and completed jobs cannot dispatch it", async () => {
  const shop = "dispatch-" + randomUUID() + ".myshopify.com";
  const other = "dispatch-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.createMany({ data: [{ shop }, { shop: other }] });
  try {
    const job = await db.contentJob.create({ data: { shop, topic: "Merchant-safe guide" } });
    const contenders = await Promise.allSettled([
      claimQueuedDispatch(shop, job.id),
      claimQueuedDispatch(shop, job.id),
    ]);
    assert.equal(contenders.filter(x => x.status === "fulfilled").length, 1);
    const rejected = contenders.find(x => x.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof DispatchAlreadyClaimedError);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: job.id } })).status, "running");
    await assert.rejects(claimQueuedDispatch(other, job.id), DispatchAlreadyClaimedError);
    await db.contentJob.update({ where: { id: job.id }, data: { status: "completed" } });
    await assert.rejects(claimQueuedDispatch(shop, job.id), DispatchAlreadyClaimedError);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: job.id } })).status, "completed");
  } finally {
    await db.contentJob.deleteMany({ where: { shop: { in: [shop, other] } } });
    await db.storeConfig.deleteMany({ where: { shop: { in: [shop, other] } } });
  }
});
