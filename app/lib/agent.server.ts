import db from "../db.server";
import * as crypto from "node:crypto";
import { unauthenticated } from "../shopify.server";
import { claimQueuedDispatch, validateN8nWebhookUrl } from "./dispatch-claim.server";
import { deliverClaimedN8nJob } from "./n8n-delivery.server";
import { createArticleCallbackToken } from "./article-callback-auth";
import { fetchVerifiedPublishedProducts, ProductContextUnavailableError } from "./product-context.server";
export { UncertainDispatchError } from "./n8n-delivery.server";

async function publishedProducts(shop: string) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    // An API outage is not evidence of an empty catalog. Abort before the
    // queued -> running claim so the reserved credit can be safely refunded.
    return await fetchVerifiedPublishedProducts(shop, admin);
  } catch {
    // Do not leak Shopify response bodies or merchant context into logs.
    throw new ProductContextUnavailableError();
  }
}

export async function dispatchArticleJob(jobId: string, shop: string) {
  const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
  const job = await db.contentJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.shop !== shop) throw new Error("Shop mismatch");
  if (!config.blogId) throw new Error("Select a Shopify blog first");

  const url = process.env.N8N_BLOG_WEBHOOK_URL;
  const secret = process.env.N8N_OUTBOUND_KEY;
  if (!url || !secret) throw new Error("n8n integration is not configured");
  validateN8nWebhookUrl(url);
  // Complete fallible DB reads and Shopify product discovery before
  // claiming the job. A failure here has not sent any paid n8n request, so
  // callers can safely fail/refund rather than strand a running job.
  // Concurrent workers may preflight, but only one can claim and POST.
  const recentRejected = await db.articleDraft.findMany({
    where: { shop, status: "rejected", reviewNotes: { not: "" } },
    take: 4, orderBy: { updatedAt: "desc" }, select: { topic: true, reviewNotes: true },
  });
  const recentPublished = await db.articleDraft.findMany({
    where: { shop, status: "published" },
    take: 8, orderBy: { updatedAt: "desc" }, select: { title: true },
  });
  // Mint a one-job callback capability BEFORE claiming or sending paid work.
  // A missing signing key is a definitive local preflight failure.
  const callbackToken = createArticleCallbackToken(shop, jobId);
  const body = {
    jobId, shop, callbackToken, topic: job.topic,
    brief: {
      audience: config.audience,
      brandVoice: config.brandVoice,
      seedTopics: config.seedTopics,
      authorName: config.authorName,
      priorPublishedTitles: recentPublished.map(x => x.title),
      avoidPatterns: recentRejected.map(x => ({ topic: x.topic, reason: x.reviewNotes })),
    },
    productCatalog: await publishedProducts(shop),
  };
  // Serialize with merchant settings changes after the preflight. A stale
  // snapshot must not send an obsolete audience, author or destination.
  await claimQueuedDispatch(shop, jobId, {
    blogId: config.blogId,
    audience: config.audience,
    brandVoice: config.brandVoice,
    seedTopics: config.seedTopics,
    authorName: config.authorName,
  });
  await deliverClaimedN8nJob({ shop, jobId, url, secret, body });
}

export function authorizedBridge(request: Request) {
  const actual = request.headers.get("X-Agent-Key") ?? "";
  const expected = process.env.N8N_CALLBACK_SECRET ?? "";
  if (!actual || !expected) return false;
  // Constant-time comparison with equal-sized digests.
  const left = crypto.createHash("sha256").update(actual).digest();
  const right = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(left, right);
}

