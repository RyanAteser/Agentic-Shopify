import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { parseRanking } from "../app/lib/seo";
import { saveRankingsForShop } from "../app/lib/ranking-ingest.server";
import {
  authorizedRankingConnector, newRankingConnectorKey, rankingKeyHash,
  rotateRankingConnectorKey, revokeRankingConnectorKey
} from "../app/lib/ranking-credentials.server";

const sample = parseRanking({ engine: "google", country: "US", device: "desktop",
  keyword: "merchant-only", position: 4, targetUrl: "https://store.example/products/boots",
  observedAt: "2026-10-26T12:00:00.000Z"
}, new Date("2026-10-26T12:00:00.000Z"));

test("ranking keys have 256 bits of randomness and DB-safe digests", () => {
  const a = newRankingConnectorKey();
  const b = newRankingConnectorKey();
  assert.match(a, /^rank_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.match(rankingKeyHash(a)!, /^[0-9a-f]{64}$/);
  assert.notEqual(rankingKeyHash(a), a);
  for (const invalid of [null, "", "legacy-shared-key", "rank_short", a + "x"]) {
    assert.equal(rankingKeyHash(invalid), null);
  }
});

test("tenant isolation, rotation, revocation and stale in-flight import prevention", async () => {
  const shopA = "key-" + randomUUID() + ".myshopify.com";
  const shopB = "key-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.createMany({ data: [{ shop: shopA }, { shop: shopB }] });
  try {
    const keyA = await rotateRankingConnectorKey(shopA);
    const keyB = await rotateRankingConnectorKey(shopB);
    const hashA = rankingKeyHash(keyA)!;
    const hashB = rankingKeyHash(keyB)!;
    const persisted = await db.rankingConnectorCredential.findUniqueOrThrow({ where: { shop: shopA } });
    assert.equal(persisted.keyHash, hashA);
    assert.ok(!JSON.stringify(persisted).includes(keyA));
    assert.equal(await authorizedRankingConnector(shopA, keyA), hashA);
    assert.equal(await authorizedRankingConnector(shopB, keyA), null);
    assert.equal(await authorizedRankingConnector(shopA, keyB), null);
    assert.equal(await authorizedRankingConnector(shopA, "legacy-shared-key"), null);

    await assert.rejects(saveRankingsForShop(shopB, [sample], hashA), /revoked/);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopB } }), 0);
    await saveRankingsForShop(shopA, [sample], hashA);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopA } }), 1);

    const replacement = await rotateRankingConnectorKey(shopA);
    const replacementHash = rankingKeyHash(replacement)!;
    assert.notEqual(replacementHash, hashA);
    assert.equal(await authorizedRankingConnector(shopA, keyA), null);
    await assert.rejects(saveRankingsForShop(shopA, [{ ...sample, keyword: "stale" }], hashA), /revoked/);
    await saveRankingsForShop(shopA, [{ ...sample, keyword: "fresh" }], replacementHash);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopA } }), 2);
    await revokeRankingConnectorKey(shopA);
    assert.equal(await authorizedRankingConnector(shopA, replacement), null);
    await assert.rejects(saveRankingsForShop(shopA, [{ ...sample, keyword: "revoked" }], replacementHash), /revoked/);
    assert.equal(await db.seoRankObservation.count({ where: { shop: shopA } }), 2);
    assert.equal(await authorizedRankingConnector(shopB, keyB), hashB);
  } finally {
    const where = { shop: { in: [shopA, shopB] } };
    await db.seoRankObservation.deleteMany({ where });
    await db.rankingConnectorCredential.deleteMany({ where });
    await db.storeConfig.deleteMany({ where });
  }
});

test("provisioning fails for an unknown store", async () => {
  await assert.rejects(rotateRankingConnectorKey("missing-" + randomUUID() + ".myshopify.com"), /Store not connected/);
});
