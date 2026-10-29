import db from "../db.server";
import * as crypto from "node:crypto";
import { unauthenticated } from "../shopify.server";
import { claimQueuedDispatch, validateN8nWebhookUrl } from "./dispatch-claim.server";
import { deliverClaimedN8nJob } from "./n8n-delivery.server";
export { UncertainDispatchError } from "./n8n-delivery.server";

async function publishedProducts(shop: string) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql query AgenticProductContext {
        products(first: 20, query: "status:active published_status:published") {
          nodes { title description onlineStoreUrl }
        }
      }`
    );
    const json: any = await response.json();
    if (json.errors?.length) return [];
    const products = json.data?.products?.nodes ?? [];
    return products.filter((p: any) => p.onlineStoreUrl).map((p: any) => ({
      name: String(p.title ?? "").slice(0, 120),
      description: String(p.description ?? "").slice(0, 400),
      url: String(p.onlineStoreUrl).slice(0, 350),
    }));
  } catch (error) {
    console.warn("Product context unavailable; using only merchant brief", error instanceof Error ? error.message : "unknown");
    return [];
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
  const body = {
    jobId, shop, topic: job.topic,
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

