import type { ActionFunctionArgs } from "react-router";
import { authorizedBridge } from "../lib/agent.server";
import { ArticleCallbackRejectedError, persistArticleCallback } from "../lib/article-callback.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorizedBridge(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (Number(request.headers.get("content-length") || "0") > 150_000) {
    return Response.json({ error: "Body too large" }, { status: 413 });
  }
  let payload: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 150_000) {
      return Response.json({ error: "Body too large" }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "Invalid draft payload" }, { status: 400 });
  }
  const data = payload as Record<string, unknown>;
  if (typeof data.jobId !== "string" || !data.jobId || data.jobId.length > 100 ||
      typeof data.shop !== "string" || !/^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$/.test(data.shop)) {
    return Response.json({ error: "Invalid job identifiers" }, { status: 400 });
  }

  try {
    const draft = await persistArticleCallback(data.shop, data.jobId, data.article);
    return Response.json({ ok: true, draftId: draft.draftId, score: draft.score });
  } catch (error) {
    if (error instanceof ArticleCallbackRejectedError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Database outages are not invalid article payloads. Return retryable 503
    // rather than misleading n8n into treating a transient failure as a 400.
    console.error("Article callback persistence unavailable",
      error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Callback persistence unavailable; retry later" }, { status: 503 });
  }
};
