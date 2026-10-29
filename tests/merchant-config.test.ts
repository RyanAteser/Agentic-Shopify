import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { loadMerchantConfig, saveMerchantConfig } from "../app/lib/merchant-config.server";
import { claimDueScheduledDraft } from "../app/lib/scheduled-drafts.server";
import { createCreditedJob } from "../app/lib/credits.server";
import { claimQueuedDispatch, DispatchAlreadyClaimedError } from "../app/lib/dispatch-claim.server";
import { eraseMerchantData } from "../app/lib/merchant-redaction.server";

const preferences = {
  blogId: "gid://shopify/Blog/123",
  authorName: "Editorial Team",
  audience: "Careful buyers",
  brandVoice: "Clear and factual",
  seedTopics: "Choosing a suitable product",
  cadenceDays: 7,
  enabled: true,
};

function newShop() {
  return "merchant-bootstrap-" + randomUUID() + ".myshopify.com";
}

test("only a persisted shop-scoped session may initialize or save merchant config", async () => {
  const shop = newShop();
  const other = newShop();
  const sessionId = "session-" + randomUUID();
  const otherId = "session-" + randomUUID();
  await db.session.create({ data: { id: otherId, shop: other, state: "", accessToken: "test-only" } });
  try {
    assert.equal(await loadMerchantConfig(shop, sessionId), null);
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), false);
    assert.equal(await db.storeConfig.count({ where: { shop } }), 0);
    assert.equal(await loadMerchantConfig(shop, otherId), null, "wrong-shop session cannot initialize config");

    await db.session.create({ data: { id: sessionId, shop, state: "", accessToken: "test-only" } });
    const config = await loadMerchantConfig(shop, sessionId);
    assert.equal(config?.shop, shop);
    assert.equal((await loadMerchantConfig(shop, sessionId))?.shop, shop);
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), true);
    const saved = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(saved.blogId, preferences.blogId);
    assert.equal(saved.enabled, true);
    const scheduled = saved.nextRunAt?.getTime();
    assert.ok(scheduled);
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), true);
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).nextRunAt?.getTime(), scheduled);

    await eraseMerchantData(shop);
    assert.equal(await loadMerchantConfig(shop, sessionId), null, "late page load cannot resurrect config");
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), false, "late POST cannot resurrect config");
    assert.equal(await db.storeConfig.count({ where: { shop } }), 0);
    assert.equal(await db.session.count({ where: { shop } }), 0);
    assert.equal(await db.session.count({ where: { shop: other } }), 1, "unrelated merchant is preserved");
  } finally {
    await eraseMerchantData(shop);
    await eraseMerchantData(other);
  }
});

test("PostgreSQL session bootstrap and settings writes cannot race past redaction", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  for (let round = 0; round < 5; round++) {
    const shop = newShop();
    const sessionId = "session-" + randomUUID();
    await db.session.create({ data: { id: sessionId, shop, state: "", accessToken: "test-only" } });
    try {
      const [load, save, redaction] = await Promise.allSettled([
        loadMerchantConfig(shop, sessionId),
        saveMerchantConfig(shop, sessionId, preferences),
        eraseMerchantData(shop),
      ]);
      assert.equal(redaction.status, "fulfilled", "redaction must not deadlock or fail");
      for (const result of [load, save]) {
        assert.equal(result.status, "fulfilled", "session-first operations must not deadlock");
      }
      assert.equal(await db.session.count({ where: { shop } }), 0);
      assert.equal(await db.storeConfig.count({ where: { shop } }), 0);
      assert.equal(await loadMerchantConfig(shop, sessionId), null);
      assert.equal(await saveMerchantConfig(shop, sessionId, preferences), false);
    } finally {
      await eraseMerchantData(shop);
    }
  }
});


test("disabling automation cancels only queued scheduled work and refunds its credit", async () => {
  const shop = newShop(), sessionId = "session-" + randomUUID();
  await db.session.create({ data: { id: sessionId, shop, state: "", accessToken: "test-only" } });
  try {
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), true);
    const scheduled = await claimDueScheduledDraft(
      (await db.storeConfig.findUniqueOrThrow({ where: { shop } })), new Date("2026-11-01T00:00:00Z")
    );
    assert.ok(scheduled);
    const manual = await createCreditedJob(shop, "Merchant-requested draft");
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 2);
    assert.equal(await saveMerchantConfig(shop, sessionId, { ...preferences, enabled: false }), true);
    const canceled = await db.contentJob.findUniqueOrThrow({ where: { id: scheduled.jobId } });
    assert.equal(canceled.status, "failed");
    assert.match(canceled.error ?? "", /merchant changed automation settings/);
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: manual.id } })).status, "queued");
    await assert.rejects(claimQueuedDispatch(shop, scheduled.jobId), DispatchAlreadyClaimedError);
    await claimQueuedDispatch(shop, manual.id);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: manual.id } })).status, "running");
    assert.equal(await saveMerchantConfig(shop, sessionId, { ...preferences, enabled: false }), true);
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1,
      "repeated disable cannot refund the same credit twice");
  } finally {
    await eraseMerchantData(shop);
  }
});

test("material editorial changes cancel queued scheduled work; unchanged settings do not", async () => {
  const shop = newShop(), sessionId = "session-" + randomUUID();
  await db.session.create({ data: { id: sessionId, shop, state: "", accessToken: "test-only" } });
  try {
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), true);
    const scheduled = await claimDueScheduledDraft(
      await db.storeConfig.findUniqueOrThrow({ where: { shop } }), new Date("2026-11-01T00:00:00Z")
    );
    assert.ok(scheduled);
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), true);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: scheduled.jobId } })).status, "queued");
    assert.equal(await saveMerchantConfig(shop, sessionId, {
      ...preferences, audience: "Different target customers"
    }), true);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: scheduled.jobId } })).status, "failed");
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 0);
  } finally {
    await eraseMerchantData(shop);
  }
});

test("PostgreSQL merchant disable and scheduled dispatch race cannot send canceled work", {
  skip: !process.env.DATABASE_URL
}, async () => {
  const shop = newShop(), sessionId = "session-" + randomUUID();
  await db.session.create({ data: { id: sessionId, shop, state: "", accessToken: "test-only" } });
  try {
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), true);
    const scheduled = await claimDueScheduledDraft(
      await db.storeConfig.findUniqueOrThrow({ where: { shop } }), new Date("2026-11-01T00:00:00Z")
    );
    assert.ok(scheduled);
    const outcomes = await Promise.allSettled([
      saveMerchantConfig(shop, sessionId, { ...preferences, enabled: false }),
      claimQueuedDispatch(shop, scheduled.jobId)
    ]);
    assert.equal(outcomes[0].status, "fulfilled");
    if (outcomes[1].status === "rejected")
      assert.ok(outcomes[1].reason instanceof DispatchAlreadyClaimedError);
    const job = await db.contentJob.findUniqueOrThrow({ where: { id: scheduled.jobId } });
    const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(config.enabled, false);
    assert.ok(job.status === "failed" || job.status === "running");
    assert.equal(config.freeDraftsUsed, job.status === "failed" ? 0 : 1);
    await assert.rejects(claimQueuedDispatch(shop, scheduled.jobId), DispatchAlreadyClaimedError);
  } finally {
    await eraseMerchantData(shop);
  }
});


test("disabling scheduling does not refund work already claimed for dispatch", async () => {
  const shop = newShop(), sessionId = "session-" + randomUUID();
  await db.session.create({ data: { id: sessionId, shop, state: "", accessToken: "test-only" } });
  try {
    assert.equal(await saveMerchantConfig(shop, sessionId, preferences), true);
    const scheduled = await claimDueScheduledDraft(
      await db.storeConfig.findUniqueOrThrow({ where: { shop } }), new Date("2026-11-01T00:00:00Z")
    );
    assert.ok(scheduled);
    await claimQueuedDispatch(shop, scheduled.jobId);
    assert.equal(await saveMerchantConfig(shop, sessionId, { ...preferences, enabled: false }), true);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: scheduled.jobId } })).status, "running");
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1,
      "claimed work may already have reached n8n and cannot be refunded automatically");
  } finally {
    await eraseMerchantData(shop);
  }
});
