import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { loadMerchantConfig, saveMerchantConfig } from "../app/lib/merchant-config.server";
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
