import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { persistArticleCallback, ArticleCallbackRejectedError } from "../app/lib/article-callback.server";
import { eraseMerchantData } from "../app/lib/merchant-redaction.server";

const article = {
  title: "A practical product selection guide",
  summary: "Compare materials, fit, care, and intended use before deciding whether a product meets your needs.",
  keyword: "product",
  tags: ["Guide"],
  body: "<h2>What to check</h2><p>Review materials, fit, product care, and suitability. Check the merchant's product listing and ask questions when claims are unclear. Compare the available options against your own needs rather than relying on unsupported promises.</p>"
};

/**
 * Runs only in the PostgreSQL CI job. This exercises real concurrent database
 * transactions, not an in-memory simulation of an uninstall race.
 */
test("PostgreSQL redaction and concurrent n8n callbacks leave no merchant data", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const other = "privacy-control-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({ data: { shop: other } });
  await db.editorialReview.create({
    data: { shop: other, draftId: "control-" + randomUUID(), decision: "usable" },
  });

  try {
    // Multiple independent races vary which operation obtains the row lock
    // first. The invariant must hold regardless of the winning operation.
    for (let round = 0; round < 5; round++) {
      const shop = "privacy-race-" + randomUUID() + ".myshopify.com";
      await db.storeConfig.create({ data: { shop } });
      const job = await db.contentJob.create({
        data: { shop, topic: "Merchant privacy race", status: "running" },
      });
      await db.editorialReview.create({
        data: { shop, draftId: "review-" + randomUUID(), decision: "rejected" },
      });

      const [first, deletion, second] = await Promise.allSettled([
        persistArticleCallback(shop, job.id, article),
        eraseMerchantData(shop),
        persistArticleCallback(shop, job.id, article),
      ]);

      assert.equal(deletion.status, "fulfilled", "redaction must complete");
      for (const result of [first, second]) {
        if (result.status === "rejected") {
          assert.ok(
            result.reason instanceof ArticleCallbackRejectedError &&
            result.reason.status === 409,
            "only a disconnected-store rejection is expected",
          );
        }
      }
      assert.equal(await db.storeConfig.count({ where: { shop } }), 0);
      assert.equal(await db.contentJob.count({ where: { shop } }), 0);
      assert.equal(await db.articleDraft.count({ where: { shop } }), 0);
      assert.equal(await db.editorialReview.count({ where: { shop } }), 0);
      await assert.rejects(
        persistArticleCallback(shop, job.id, article),
        (error: unknown) => error instanceof ArticleCallbackRejectedError && error.status === 409,
      );
      await eraseMerchantData(shop); // a retried Shopify webhook is safe
    }

    assert.equal(await db.storeConfig.count({ where: { shop: other } }), 1);
    assert.equal(await db.editorialReview.count({ where: { shop: other } }), 1);
  } finally {
    await eraseMerchantData(other);
  }
});
