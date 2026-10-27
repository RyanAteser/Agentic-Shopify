import db from "../db.server";
import { evaluateArticle } from "./content-quality.server";

export class ArticleCallbackRejectedError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409) {
    super(message);
    this.name = "ArticleCallbackRejectedError";
  }
}

/**
 * Persist a verified n8n callback without racing Shopify uninstall/redaction.
 *
 * The first write locks the merchant StoreConfig row on PostgreSQL, matching
 * the first deletion in both privacy webhooks. No network calls occur inside
 * the transaction. A late callback cannot recreate deleted merchant drafts.
 */
export async function persistArticleCallback(shop: string, jobId: string, rawArticle: unknown) {
  let checked: ReturnType<typeof evaluateArticle>;
  try {
    checked = evaluateArticle(rawArticle);
  } catch (error) {
    throw new ArticleCallbackRejectedError(
      error instanceof Error ? error.message : "Invalid article payload", 400
    );
  }

  return db.$transaction(async tx => {
    const active = await tx.storeConfig.updateMany({
      where: { shop }, data: { updatedAt: new Date() }
    });
    if (active.count !== 1) {
      throw new ArticleCallbackRejectedError("Store disconnected", 409);
    }
    const job = await tx.contentJob.findUnique({ where: { id: jobId } });
    if (!job || job.shop !== shop) {
      throw new ArticleCallbackRejectedError("Unknown job", 404);
    }
    if (!["queued", "running", "completed", "dispatch_uncertain"].includes(job.status)) {
      throw new ArticleCallbackRejectedError("Job cannot receive articles", 409);
    }

    // A successful retry returns the stored result, not a new model's score.
    // Completed jobs without a draft are inconsistent and require investigation.
    if (job.status === "completed") {
      const existing = await tx.articleDraft.findUnique({ where: { jobId } });
      if (!existing || existing.shop !== shop) {
        throw new ArticleCallbackRejectedError("Completed job has no saved draft", 409);
      }
      return { draftId: existing.id, score: existing.seoScore };
    }

    const draft = await tx.articleDraft.upsert({
      where: { jobId },
      create: {
        jobId, shop, topic: job.topic, title: checked.article.title,
        summary: checked.article.summary, body: checked.article.body,
        tags: checked.article.tags.join(","), keyword: checked.article.keyword,
        seoScore: checked.score,
        status: checked.score >= 70 ? "ready" : "needs_review",
        reviewNotes: checked.warnings.join("\n")
      },
      update: {} // never overwrite merchant edits or an existing draft
    });
    await tx.contentJob.updateMany({
      where: { id: jobId, shop, status: { in: ["queued", "running", "dispatch_uncertain"] } },
      data: { status: "completed" }
    });
    return { draftId: draft.id, score: draft.seoScore };
  });
}
