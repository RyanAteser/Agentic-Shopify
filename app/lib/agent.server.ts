import db from "../db.server";
import * as crypto from "node:crypto";
import { unauthenticated } from "../shopify.server";

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
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!url || !secret || !appUrl) throw new Error("n8n integration is not configured");
  if (!url.startsWith("https://") && !url.startsWith("http://localhost")) {
    throw new Error("n8n URL must use HTTPS");
  }
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
    callbackUrl: appUrl.replace(/\/$/, "") + "/api/agent/complete",
    productCatalog: await publishedProducts(shop),
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Key": secret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("n8n rejected generation request (" + response.status + ")");
  await db.contentJob.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "running" } });
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

