import type { ActionFunctionArgs } from "react-router";
import { authorizedArticleCallback } from "../lib/article-callback-auth";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../lib/request-body.server";
import { ArticleCallbackRejectedError, persistArticleCallback } from "../lib/article-callback.server";

import { assertPilotServiceDisabled } from "../lib/pilot-readonly";

export const action = async ({ request }: ActionFunctionArgs) => {
  assertPilotServiceDisabled();
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  let payload: unknown;
  try {
    // Reject oversized chunked requests before buffering or JSON parsing.
    const raw = await readBoundedRequestText(request, 150_000);
    payload = JSON.parse(raw);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Body too large" }, { status: 413 });
    }
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "Invalid draft payload" }, { status: 400 });
  }
  const data = payload as Record<string, unknown>;
  if (typeof data.jobId !== "string" || !data.jobId || data.jobId.length > 100 ||
      typeof data.shop !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(data.shop)) {
    return Response.json({ error: "Invalid job identifiers" }, { status: 400 });
  }

  // The global n8n bridge secret is deliberately NOT valid for article writes.
  // Authenticate the tenant/job pair before any database mutation.
  if (!authorizedArticleCallback(data.shop, data.jobId, request.headers.get("X-Agent-Key"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const draft = await persistArticleCallback(data.shop, data.jobId, data.article, data.usage);
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
