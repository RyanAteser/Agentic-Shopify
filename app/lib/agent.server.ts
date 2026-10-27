import db from "../db.server";
import * as crypto from "node:crypto";
import { unauthenticated } from "../shopify.server";
import { claimQueuedDispatch, classifyN8nDispatchStatus, validateN8nWebhookUrl } from "./dispatch-claim.server";

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


export class UncertainDispatchError extends Error {
  constructor(){super("Could not confirm n8n acceptance. This job is awaiting reconciliation; no credit was refunded.");this.name="UncertainDispatchError";}
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
  // Claim BEFORE product context, prompt history or network I/O. Concurrent
  // requests for the same job must not send duplicate paid n8n work.
  await claimQueuedDispatch(shop, jobId);
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
  let response:Response;
  try{
    response=await fetch(url,{
      method:"POST",
      // Never forward the n8n webhook credential to a redirected host.
      redirect:"error",
      headers:{"Content-Type":"application/json","X-Agent-Key":secret},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(12_000),
    });
  }catch(err){
    // A timeout is NOT proof that the workflow failed: n8n may still generate
    // and send the callback. Preserve the credit and accept a later callback.
    await db.contentJob.updateMany({
      where:{id:jobId,shop,status:"running"},
      data:{status:"dispatch_uncertain",error:"Transport outcome unknown; manual reconciliation needed"}
    });
    throw new UncertainDispatchError();
  }
  const outcome = classifyN8nDispatchStatus(response.status);
  if (outcome === "uncertain") {
    // Timeouts, throttling, conflicts, redirects and server errors can be
    // produced by intermediaries. They do not establish that n8n did no work.
    await db.contentJob.updateMany({
      where: { id: jobId, shop, status: "running" },
      data: { status: "dispatch_uncertain",
        error: "n8n HTTP " + response.status + "; acceptance unknown; reconcile execution" }
    });
    throw new UncertainDispatchError();
  }
  if (outcome === "rejected") {
    // Only known permanent request rejections permit the caller to refund.
    throw new Error("n8n rejected generation request (HTTP " + response.status + ")");
  }
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

