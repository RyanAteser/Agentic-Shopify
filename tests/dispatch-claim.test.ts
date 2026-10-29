import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { claimQueuedDispatch, classifyN8nDispatchStatus, DispatchAlreadyClaimedError, generationJobNotice, validateN8nWebhookUrl } from "../app/lib/dispatch-claim.server";

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


test("only known permanent n8n rejections allow refund; transient HTTP outcomes require reconciliation", () => {
  for (const status of [200, 201, 202, 204]) {
    assert.equal(classifyN8nDispatchStatus(status), "accepted", String(status));
  }
  for (const status of [400, 401, 403, 404, 405, 410, 413, 415, 422]) {
    assert.equal(classifyN8nDispatchStatus(status), "rejected", String(status));
  }
  for (const status of [0, 301, 307, 308, 402, 408, 409, 425, 429, 500, 502, 503, 504, 599]) {
    assert.equal(classifyN8nDispatchStatus(status), "uncertain", String(status));
  }
});

test("stalled job notices are advisory and never mislabel completed jobs", () => {
  const now = new Date("2026-10-27T17:00:00.000Z");
  const fresh = new Date("2026-10-27T16:45:00.000Z");
  const stale = new Date("2026-10-27T16:29:59.000Z");
  assert.equal(generationJobNotice("running", fresh, now), null);
  assert.equal(generationJobNotice("queued", fresh, now), null);
  assert.match(generationJobNotice("running", stale, now)!, /30 minutes/);
  assert.match(generationJobNotice("queued", stale, now)!, /30 minutes/);
  assert.match(generationJobNotice("dispatch_uncertain", fresh, now)!, /inspect the n8n execution/);
  assert.equal(generationJobNotice("completed", stale, now), null);
  assert.equal(generationJobNotice("failed", stale, now), null);
  assert.equal(generationJobNotice("running", new Date("invalid"), now), null);
});

test("stale preflight cannot claim a queued job after any editorial setting changes", async () => {
  const shop = "brief-claim-" + randomUUID() + ".myshopify.com";
  const expected = {
    blogId: "gid://shopify/Blog/1",
    audience: "Beginners",
    brandVoice: "Plain language",
    seedTopics: "Sizing advice",
    authorName: "Editorial Team",
  };
  await db.storeConfig.create({ data: { shop, ...expected } });
  try {
    const job = await db.contentJob.create({ data: {
      shop, topic: "Sizing advice", outboxVersion: 1
    } });
    for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
      await db.storeConfig.update({ where: { shop }, data: { [field]: "changed-" + field } });
      await assert.rejects(claimQueuedDispatch(shop, job.id, expected), DispatchAlreadyClaimedError);
      assert.equal(
        (await db.contentJob.findUniqueOrThrow({ where: { id: job.id } })).status,
        "queued", "no irreversible dispatch claim on a stale merchant brief"
      );
      await db.storeConfig.update({ where: { shop }, data: { [field]: expected[field] } });
    }
    await claimQueuedDispatch(shop, job.id, expected);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: job.id } })).status, "running");
    await assert.rejects(claimQueuedDispatch(shop, job.id, expected), DispatchAlreadyClaimedError);
  } finally {
    await db.contentJob.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
});
