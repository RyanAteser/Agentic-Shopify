import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { persistArticleCallback, ArticleCallbackRejectedError } from "../app/lib/article-callback.server";

const article = {
  title: "How to choose the right product for your needs",
  summary: "Practical guidance for evaluating a product's fit, care instructions, and suitability before making a purchase decision.",
  keyword: "product",
  tags: ["Guide"],
  body: "<h2>Choosing well</h2><p>Compare the product's material, fit, care instructions and intended use with your own requirements. Check the product listing and contact the merchant if a claim is unclear. Make sure the product actually addresses your needs before purchasing.</p>"
};

function isRejected(status: number) {
  return (error: unknown) =>
    error instanceof ArticleCallbackRejectedError && error.status === status;
}

test("article callbacks are tenant-scoped, idempotent and preserve completed drafts", async () => {
  const shop = "callback-" + randomUUID() + ".myshopify.com";
  const other = "callback-" + randomUUID() + ".myshopify.com";
  const where = { shop: { in: [shop, other] } };
  await db.storeConfig.createMany({ data: [{ shop }, { shop: other }] });
  try {
    const job = await db.contentJob.create({ data: { shop, topic: "Products", status: "running" } });
    const failed = await db.contentJob.create({ data: { shop, topic: "Failed", status: "failed" } });
    const uncertain = await db.contentJob.create({ data: { shop, topic: "Uncertain", status: "dispatch_uncertain" } });
    const inconsistent = await db.contentJob.create({ data: { shop, topic: "Missing draft", status: "completed" } });

    await assert.rejects(persistArticleCallback(other, job.id, article), isRejected(404));
    assert.equal(await db.articleDraft.count({ where: { shop: other } }), 0);
    await assert.rejects(persistArticleCallback(shop, failed.id, article), isRejected(409));
    await assert.rejects(persistArticleCallback(shop, inconsistent.id, article), isRejected(409));

    const first = await persistArticleCallback(shop, job.id, article);
    const replay = await persistArticleCallback(shop, job.id, {
      ...article, title: "A conflicting regenerated title"
    });
    assert.deepEqual(replay, first, "a retry must report the saved draft and score");
    assert.equal(await db.articleDraft.count({ where: { jobId: job.id } }), 1);
    assert.equal((await db.articleDraft.findUniqueOrThrow({ where: { jobId: job.id } })).title, article.title);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: job.id } })).status, "completed");

    const late = await persistArticleCallback(shop, uncertain.id, article);
    assert.ok(late.draftId, "an uncertain network dispatch can still complete via callback");
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: uncertain.id } })).status, "completed");
    await assert.rejects(persistArticleCallback(shop, job.id, null), isRejected(400));
  } finally {
    await db.editorialReview.deleteMany({ where });
    await db.articleDraft.deleteMany({ where });
    await db.contentJob.deleteMany({ where });
    await db.storeConfig.deleteMany({ where });
  }
});

test("a late n8n callback cannot resurrect data after store redaction", async () => {
  const shop = "redacted-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({ data: { shop } });
  const job = await db.contentJob.create({ data: { shop, topic: "Late delivery", status: "running" } });
  try {
    // Privacy webhook deletes the configuration first, before child rows.
    // This models the interval in which a callback still knows a valid job ID.
    await db.storeConfig.delete({ where: { shop } });
    await assert.rejects(persistArticleCallback(shop, job.id, article), isRejected(409));
    assert.equal(await db.articleDraft.count({ where: { shop } }), 0);
    await db.contentJob.deleteMany({ where: { shop } });
    await assert.rejects(persistArticleCallback(shop, job.id, article), isRejected(409));
    assert.equal(await db.articleDraft.count({ where: { shop } }), 0);
  } finally {
    await db.articleDraft.deleteMany({ where: { shop } });
    await db.contentJob.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
});

test("oversized model callback persists an editable needs-review draft, not a ready article", async () => {
  const shop = "large-callback-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({data:{shop}});
  try {
    const job = await db.contentJob.create({data:{shop, topic:"Large draft", status:"running"}});
    const oversized = {...article, body: article.body + "<p>" + "é".repeat(31_000) + "</p>"};
    const saved = await persistArticleCallback(shop, job.id, oversized);
    const draft = await db.articleDraft.findUniqueOrThrow({where:{id:saved.draftId}});
    assert.equal(draft.status, "needs_review");
    assert.ok(draft.seoScore < 70);
    assert.match(draft.reviewNotes, /60 KB UTF-8 safety budget/);
    assert.ok(Buffer.byteLength(draft.body, "utf8") > 60_000);
    assert.equal((await db.contentJob.findUniqueOrThrow({where:{id:job.id}})).status, "completed");
  } finally {
    await db.editorialReview.deleteMany({where:{shop}});
    await db.articleDraft.deleteMany({where:{shop}});
    await db.contentJob.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
});
