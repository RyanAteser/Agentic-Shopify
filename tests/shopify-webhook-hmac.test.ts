import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import db from "../app/db.server";
import { saveRankingsForShop } from "../app/lib/ranking-ingest.server";
import { parseRanking } from "../app/lib/seo";
import { rotateRankingConnectorKey, rankingKeyHash } from "../app/lib/ranking-credentials.server";

/**
 * Exercise Shopify's actual authenticate.webhook(request) integration, not a
 * duplicate home-grown HMAC validator. A forged privacy webhook must not erase
 * any merchant data, while an authentic delivery must erase only its own shop.
 * This uses synthetic credentials and synthetic shops, never live merchants.
 */
test("shop/redact rejects forged and modified HMACs, erases only the signed shop and tolerates retries", async () => {
  const keys = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const secret = "shopify-webhook-test-secret-32-characters";
  process.env.SHOPIFY_API_KEY = "shopify-webhook-test-client";
  process.env.SHOPIFY_API_SECRET = secret;
  process.env.SHOPIFY_APP_URL = "https://shopify-webhook-test.example";
  process.env.SCOPES = "write_content,read_products";

  const shop = "redact-" + randomUUID() + ".myshopify.com";
  const otherShop = "keep-" + randomUUID() + ".myshopify.com";
  const property = "sc-domain:example.test";
  const raw = JSON.stringify({ shop_id: 12345, shop_domain: shop });
  const signature = (body: string, key = secret) =>
    createHmac("sha256", key).update(body, "utf8").digest("base64");
  const request = (body: string, hmac: string) => new Request(
    "https://shopify-webhook-test.example/webhooks/shop/redact",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "shop/redact",
        "X-Shopify-Shop-Domain": shop,
        "X-Shopify-Hmac-Sha256": hmac,
        "X-Shopify-Webhook-Id": randomUUID(),
        "X-Shopify-Api-Version": "2026-10",
      },
      body,
    },
  );
  const args = (req: Request) => ({ request: req, params: {}, context: {} }) as any;
  try {
    // Dynamic import ensures Shopify SDK is configured with synthetic test
    // credentials before its singleton is initialized.
    const { action } = await import("../app/routes/webhooks.shop.redact");
    await db.storeConfig.createMany({ data: [{ shop }, { shop: otherShop }] });
    // Synthetic review rows exercise the real webhook erasure path.
    await db.editorialReview.createMany({data:[
      {shop,draftId:"synthetic-"+randomUUID(),decision:"usable",reviewMinutes:12},
      {shop:otherShop,draftId:"synthetic-"+randomUUID(),decision:"rejected",
        reviewMinutes:7,feedback:"Incorrect sources"}
    ]});
    const rankingKey = rankingKeyHash(await rotateRankingConnectorKey(shop))!;
    await rotateRankingConnectorKey(otherShop);
    await db.organicDailyMetric.createMany({
      data: [
        { shop, property, date: "2026-10-01", clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
        { shop: otherShop, property, date: "2026-10-01", clicks: 2, impressions: 20, ctr: 0.1, position: 7 },
      ],
    });
    const rankAt = new Date("2026-10-26T12:00:00Z");
    await db.seoRankObservation.createMany({ data: [
      { shop, keyword: "boots", position: 5, targetUrl: "https://example.test/boots", observedAt: rankAt },
      { shop: otherShop, keyword: "boots", position: 3, targetUrl: "https://example.test/boots", observedAt: rankAt },
    ] });
    await db.googleAuthState.create({
      data: { stateHash: randomUUID(), shop, expiresAt: new Date(Date.now() + 60_000) },
    });
    await db.searchConsoleConnection.create({
      data: { shop, property, encryptedRefresh: "synthetic-token-not-valid" },
    });

    for (const forged of [
      request(raw, signature(raw, "attacker-secret")),
      request(raw + " ", signature(raw)),
    ]) {
      await assert.rejects(action(args(forged)), (error: unknown) =>
        error instanceof Response && error.status === 401,
      );
      assert.equal(await db.storeConfig.count({ where: { shop } }), 1);
      assert.equal(await db.rankingConnectorCredential.count({ where: { shop } }), 1);
      assert.equal(await db.searchConsoleConnection.count({ where: { shop } }), 1);
      assert.equal(await db.organicDailyMetric.count({ where: { shop } }), 1);
      assert.equal(await db.seoRankObservation.count({ where: { shop } }), 1);
      assert.equal(await db.editorialReview.count({ where: { shop } }), 1);
    }

    const response = await action(args(request(raw, signature(raw))));
    assert.equal(response.status, 200);
    assert.equal(await db.storeConfig.count({ where: { shop } }), 0);
    assert.equal(await db.rankingConnectorCredential.count({ where: { shop } }), 0);
    assert.equal(await db.googleAuthState.count({ where: { shop } }), 0);
    assert.equal(await db.searchConsoleConnection.count({ where: { shop } }), 0);
    assert.equal(await db.organicDailyMetric.count({ where: { shop } }), 0);
    assert.equal(await db.seoRankObservation.count({ where: { shop } }), 0);
    assert.equal(await db.editorialReview.count({ where: { shop } }), 0);
    const lateRank = parseRanking({ engine: "google", country: "US", device: "desktop", keyword: "late boots", position: 7,
      observedAt: rankAt.toISOString(), targetUrl: "https://example.test/boots" }, rankAt);
    await assert.rejects(saveRankingsForShop(shop, [lateRank], rankingKey), /Store disconnected/);
    assert.equal(await db.seoRankObservation.count({ where: { shop } }), 0);
    assert.equal(await db.storeConfig.count({ where: { shop: otherShop } }), 1);
    assert.equal(await db.rankingConnectorCredential.count({ where: { shop: otherShop } }), 1);
    assert.equal(await db.organicDailyMetric.count({ where: { shop: otherShop } }), 1);
    assert.equal(await db.seoRankObservation.count({ where: { shop: otherShop } }), 1);
    assert.equal(await db.editorialReview.count({ where: { shop: otherShop } }), 1);

    // Shopify retries deliveries; deletion must be idempotent.
    const retried = await action(args(request(raw, signature(raw))));
    assert.equal(retried.status, 200);
    assert.equal(await db.storeConfig.count({ where: { shop: otherShop } }), 1);
  } finally {
    const where = { shop: { in: [shop, otherShop] } };
    await db.googleAuthState.deleteMany({ where });
    await db.searchConsoleConnection.deleteMany({ where });
    await db.organicDailyMetric.deleteMany({ where });
    await db.storeActivity.deleteMany({ where });
    await db.storeRecommendation.deleteMany({ where });
    await db.editorialReview.deleteMany({ where });
    await db.articleDraft.deleteMany({ where });
    await db.seoRankObservation.deleteMany({ where });
    await db.rankingConnectorCredential.deleteMany({ where });
    await db.contentJob.deleteMany({ where });
    await db.storeConfig.deleteMany({ where });
    await db.session.deleteMany({ where });
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
