import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A writer receives a capability for ONE tenant/job, not the global bridge
 * credential used by the scheduler and recovery workflows. No callback key
 * is exposed to n8n. Keep this separate from Shopify and n8n bridge secrets.
 */
function signingKey(): Buffer {
  const encoded = process.env.ARTICLE_CALLBACK_SIGNING_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("ARTICLE_CALLBACK_SIGNING_KEY must be 32 random base64-encoded bytes");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("ARTICLE_CALLBACK_SIGNING_KEY is not canonical base64");
  }
  return key;
}

export function createArticleCallbackToken(shop: string, jobId: string): string {
  return createHmac("sha256", signingKey())
    .update("agentic-shopify-article-callback-v1\0")
    .update(shop, "utf8")
    .update("\0")
    .update(jobId, "utf8")
    .digest("base64url");
}

export function authorizedArticleCallback(
  shop: string, jobId: string, presented: string | null
): boolean {
  if (!presented || !/^[A-Za-z0-9_-]{43}$/.test(presented)) return false;
  try {
    const expected = createArticleCallbackToken(shop, jobId);
    return timingSafeEqual(Buffer.from(presented, "ascii"), Buffer.from(expected, "ascii"));
  } catch {
    // Missing/malformed signing configuration must fail closed.
    return false;
  }
}
