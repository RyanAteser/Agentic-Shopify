import db from "../db.server";
import { evaluateArticle } from "./content-quality.server";
import {parseBlogUsage} from "./blog-usage";

export class ArticleCallbackRejectedError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409) {
    super(message);
    this.name = "ArticleCallbackRejectedError";
  }
}

/**
 * Persist a verified n8n callback without racing Shopify uninstall/redaction.
 *
 * The first write locks the merchant StoreConfig row on PostgreSQL.
 * Redaction deletes persisted Sessions first (to fence authenticated page
 * loads), then StoreConfig, before removing drafts and jobs. No network calls
 * occur inside this transaction. A late callback cannot recreate drafts.
 */
export async function persistArticleCallback(shop: string, jobId: string, rawArticle: unknown, rawUsage?: unknown) {
  let checked: ReturnType<typeof evaluateArticle>;
  let receipts:ReturnType<typeof parseBlogUsage>;
  try {
    checked = evaluateArticle(rawArticle);
    receipts = parseBlogUsage(rawUsage);
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
    // A callback is only legitimate after the queued -> running dispatch claim.
    // Accepting queued jobs would let a delayed/misrouted n8n execution
    // create a draft for work that was never dispatched.
    if (!["running", "completed", "dispatch_uncertain"].includes(job.status)) {
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
    if(receipts.length){
      await tx.blogGenerationUsage.createMany({data:receipts.map(row=>({
        shop,jobId,stage:row.stage,model:row.model,inputTokens:row.inputTokens,
        outputTokens:row.outputTokens,responseIdHash:row.responseIdHash
      }))});
    }
    await tx.contentJob.updateMany({
      where: { id: jobId, shop, status: { in: ["running", "dispatch_uncertain"] } },
      data: { status: "completed" }
    });
    return { draftId: draft.id, score: draft.seoScore };
  });
}
