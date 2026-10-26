import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authorizedBridge } from "../lib/agent.server";
import { evaluateArticle } from "../lib/content-quality.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorizedBridge(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (Number(request.headers.get("content-length") || "0") > 150_000) {
    return Response.json({ error: "Body too large" }, { status: 413 });
  }
  try {
    const raw = await request.text();
    if (raw.length > 150_000) return Response.json({ error: "Body too large" }, { status: 413 });
    const payload = JSON.parse(raw);
    const jobId = String(payload.jobId ?? "");
    const shop = String(payload.shop ?? "");
    if (!jobId || !shop) return Response.json({ error: "Missing job identifiers" }, { status: 400 });
    const job = await db.contentJob.findUnique({ where: { id: jobId } });
    if (!job || job.shop !== shop) return Response.json({ error: "Unknown job" }, { status: 404 });
    if (!["queued", "running", "completed", "dispatch_uncertain"].includes(job.status)) {
      return Response.json({ error: "Job cannot receive articles" }, { status: 409 });
    }
    const checked = evaluateArticle(payload.article);
    // One upsert guards simultaneous/retried callbacks against duplicate drafts.
    const draft = await db.articleDraft.upsert({
      where:{jobId},
      create:{
        jobId,shop,topic:job.topic,title:checked.article.title,
        summary:checked.article.summary,body:checked.article.body,
        tags:checked.article.tags.join(","),keyword:checked.article.keyword,
        seoScore:checked.score,status:checked.score>=70?"ready":"needs_review",
        reviewNotes:checked.warnings.join("\n")
      },
      update:{} // never overwrite an edited or published article on callback retry
    });
    await db.contentJob.updateMany({
      where:{id:jobId,shop,status:{in:["queued","running","dispatch_uncertain"]}},
      data:{status:"completed"}
    });
    return Response.json({ ok: true, draftId: draft.id, score: checked.score });
  } catch (error) {
    console.error("Article callback failed", error);
    return Response.json({ error: "Invalid draft payload" }, { status: 400 });
  }
};
