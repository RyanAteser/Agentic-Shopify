import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { parseRanking } from "../app/lib/seo";
import {
  primaryDomainForShop, saveRankingsForShop, reserveRankingImportBudget,
  RankingImportRateLimitError, RANKING_REQUESTS_PER_HOUR, RANKING_RECORDS_PER_HOUR
} from "../app/lib/ranking-ingest.server";
import { rotateRankingConnectorKey, rankingKeyHash } from "../app/lib/ranking-credentials.server";

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
    const keyHash = rankingKeyHash(await rotateRankingConnectorKey(shopA))!;
    await saveRankingsForShop(shopA, [rank], keyHash);
    await saveRankingsForShop(shopA, [rank], keyHash);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopA } }), 1);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopB } }), 0);
    await db.storeConfig.delete({ where: { shop: shopA } });
    await assert.rejects(saveRankingsForShop(shopA, [{...rank,keyword:"other"}], keyHash),
      /Store disconnected/);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopA } }), 1);
  } finally {
    await db.seoRankObservation.deleteMany({ where: { shop: { in: [shopA, shopB] } } });
    await db.rankingConnectorCredential.deleteMany({ where: { shop: { in: [shopA, shopB] } } });
    await db.storeConfig.deleteMany({ where: { shop: { in: [shopA, shopB] } } });
  }
});

test("database failure rolls back the entire ranking batch", async () => {
  const shop = "ranking-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({ data: { shop } });
  try {
    const keyHash = rankingKeyHash(await rotateRankingConnectorKey(shop))!;
    await assert.rejects(saveRankingsForShop(shop, [rank, {
      ...rank, keyword: "bad-date", observedAt: new Date(NaN)
    }], keyHash));
    assert.equal(await db.seoRankObservation.count({ where: { shop } }), 0);
  } finally {
    await db.seoRankObservation.deleteMany({ where: { shop } });
    await db.rankingConnectorCredential.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
});

test("durable tenant ranking budgets enforce both limits and UTC rollover", async () => {
  const shopA = "budget-" + randomUUID() + ".myshopify.com";
  const shopB = "budget-" + randomUUID() + ".myshopify.com";
  const hour = new Date("2026-10-26T12:00:00.000Z");
  await db.storeConfig.createMany({ data: [{ shop: shopA }, { shop: shopB }] });
  try {
    const keyA = rankingKeyHash(await rotateRankingConnectorKey(shopA))!;
    const keyB = rankingKeyHash(await rotateRankingConnectorKey(shopB))!;
    // Force the threshold without 60 slow database round trips.
    await db.storeConfig.update({ where: { shop: shopA }, data: {
      rankingWindowStart: hour,
      rankingRequestsUsed: RANKING_REQUESTS_PER_HOUR - 1,
      rankingRecordsUsed: RANKING_RECORDS_PER_HOUR - 1
    } });
    await reserveRankingImportBudget(shopA, keyA, 1, new Date("2026-10-26T12:00:01.000Z"));
    const atCap = await db.storeConfig.findUniqueOrThrow({ where: { shop: shopA } });
    assert.equal(atCap.rankingRequestsUsed, RANKING_REQUESTS_PER_HOUR);
    assert.equal(atCap.rankingRecordsUsed, RANKING_RECORDS_PER_HOUR);
    await assert.rejects(
      reserveRankingImportBudget(shopA, keyA, 1, new Date("2026-10-26T12:00:02.000Z")),
      (e: unknown) => e instanceof RankingImportRateLimitError && e.retryAfterSeconds === 3598
    );
    // Rejected requests never consume additional budget.
    const unchanged = await db.storeConfig.findUniqueOrThrow({ where: { shop: shopA } });
    assert.equal(unchanged.rankingRequestsUsed, RANKING_REQUESTS_PER_HOUR);
    await reserveRankingImportBudget(shopB, keyB, 50, new Date("2026-10-26T12:00:02.000Z"));
    const other = await db.storeConfig.findUniqueOrThrow({ where: { shop: shopB } });
    assert.equal(other.rankingRequestsUsed, 1);
    assert.equal(other.rankingRecordsUsed, 50);
    // New hour resets this shop's counters, without affecting another shop.
    await reserveRankingImportBudget(shopA, keyA, 50, new Date("2026-10-26T13:00:00.000Z"));
    const reset = await db.storeConfig.findUniqueOrThrow({ where: { shop: shopA } });
    assert.equal(reset.rankingRequestsUsed, 1);
    assert.equal(reset.rankingRecordsUsed, 50);
    assert.equal(reset.rankingWindowStart?.toISOString(), "2026-10-26T13:00:00.000Z");
    await assert.rejects(reserveRankingImportBudget(shopB, keyA, 1, hour), /revoked/);
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop: shopB } })).rankingRequestsUsed, 1);
  } finally {
    const where = { shop: { in: [shopA, shopB] } };
    await db.rankingConnectorCredential.deleteMany({ where });
    await db.storeConfig.deleteMany({ where });
  }
});

test("ranking record quota can reject a batch before request-count limit", async () => {
  const shop = "recordbudget-" + randomUUID() + ".myshopify.com";
  const now = new Date("2026-10-26T12:10:00.000Z");
  await db.storeConfig.create({ data: {
    shop, rankingWindowStart: new Date("2026-10-26T12:00:00.000Z"),
    rankingRequestsUsed: 2, rankingRecordsUsed: RANKING_RECORDS_PER_HOUR - 10
  } });
  try {
    const keyHash = rankingKeyHash(await rotateRankingConnectorKey(shop))!;
    await assert.rejects(reserveRankingImportBudget(shop, keyHash, 11, now),
      (e: unknown) => e instanceof RankingImportRateLimitError && e.retryAfterSeconds === 3000);
    await reserveRankingImportBudget(shop, keyHash, 10, now);
    const state = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(state.rankingRequestsUsed, 3);
    assert.equal(state.rankingRecordsUsed, RANKING_RECORDS_PER_HOUR);
  } finally {
    await db.rankingConnectorCredential.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
});
