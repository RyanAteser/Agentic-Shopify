import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { parseRanking } from "../app/lib/seo";
import { primaryDomainForShop, saveRankingsForShop } from "../app/lib/ranking-ingest.server";

const now = new Date("2026-10-26T12:00:00.000Z");
const rank = parseRanking({ keyword: "boots", position: 5,
  observedAt: now.toISOString(), targetUrl: "https://shop.example/products/boots" }, now);

test("Shopify Admin domain attestation rejects another store and missing primary domain", async () => {
  const admin = (shop: string, host: string | null) => ({
    graphql: async () => ({ json: async () => ({
      data: { shop: { myshopifyDomain: shop, primaryDomain: host ? { host } : null } }
    }) })
  });
  assert.equal(await primaryDomainForShop(admin("a.myshopify.com", "shop.example"), "a.myshopify.com"), "shop.example");
  await assert.rejects(primaryDomainForShop(admin("b.myshopify.com", "shop.example"), "a.myshopify.com"));
  await assert.rejects(primaryDomainForShop(admin("a.myshopify.com", null), "a.myshopify.com"));
});

test("rank batches are idempotent, tenant-scoped and blocked after uninstall", async () => {
  const shopA = "ranking-" + randomUUID() + ".myshopify.com";
  const shopB = "ranking-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.createMany({ data: [{ shop: shopA }, { shop: shopB }] });
  try {
    await saveRankingsForShop(shopA, [rank]);
    await saveRankingsForShop(shopA, [rank]);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopA } }), 1);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopB } }), 0);
    await db.storeConfig.delete({ where: { shop: shopA } });
    await assert.rejects(saveRankingsForShop(shopA, [{...rank,keyword:"other"}]),
      /Store disconnected/);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopA } }), 1);
  } finally {
    await db.seoRankObservation.deleteMany({ where: { shop: { in: [shopA, shopB] } } });
    await db.storeConfig.deleteMany({ where: { shop: { in: [shopA, shopB] } } });
  }
});

test("database failure rolls back the entire ranking batch", async () => {
  const shop = "ranking-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({ data: { shop } });
  try {
    await assert.rejects(saveRankingsForShop(shop, [rank, {
      ...rank, keyword: "bad-date", observedAt: new Date(NaN)
    }]));
    assert.equal(await db.seoRankObservation.count({ where: { shop } }), 0);
  } finally {
    await db.seoRankObservation.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
});
