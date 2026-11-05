import { createHash } from "node:crypto";
import db from "../db.server";
import { evaluateArticle, isArticleHtmlWithinBudget } from "./content-quality.server";

export type EditableDraftFields = {
  title: string; summary: string; body: string; tags: string; keyword: string;
};
export type DraftEditInput = EditableDraftFields;

/** Optimistic form version: covers all merchant-editable fields, not only Shopify's publication digest. */
export function editorialEditDigest(fields: EditableDraftFields): string {
  return createHash("sha256").update(JSON.stringify([
    "merchant-draft-edit-v1", fields.title, fields.summary,
    fields.body, fields.tags, fields.keyword
  ]), "utf8").digest("hex");
}

/**
 * Save a merchant's corrections without touching Shopify or starting another paid generation.
 * The merchant row is locked first to serialize with review, publishing and redaction.
 * Stale browser forms must not overwrite another editor's work.
 */
export async function saveMerchantDraftEdit(
  shop: string, draftId: string, expectedDigest: string, raw: unknown
): Promise<{ok: boolean; message: string}> {
  if (!shop || !draftId || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    return {ok: false, message: "Invalid or outdated edit form. Refresh the draft."};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {ok: false, message: "Invalid draft edit."};
  }
  const input = raw as Record<string, unknown>;
  const fields = ["title", "summary", "body", "tags", "keyword"] as const;
  if (fields.some(key => typeof input[key] !== "string")) {
    return {ok: false, message: "All draft fields must be text."};
  }
  const title = (input.title as string).trim();
  const summary = (input.summary as string).trim();
  const body = input.body as string;
  const keyword = (input.keyword as string).trim();
  const tagsRaw = input.tags as string;
  // Explicit limits prevent silent truncation of a merchant's edits.
  // 60 KB is a conservative buffer under Shopify's rich-text content limit.
  if (!title || title.length > 160 || !summary || summary.length > 500 ||
      !body.trim() || !isArticleHtmlWithinBudget(body) || keyword.length > 120 ||
      tagsRaw.length > 320) {
    return {ok: false, message: "Title (1–160), excerpt (1–500), HTML body (1–60,000), keyword (0–120) or tags (0–320) are outside allowed limits."};
  }
  const tags = tagsRaw.split(",").map(tag => tag.trim()).filter(Boolean);
  if (tags.length > 8 || tags.some(tag => tag.length > 40)) {
    return {ok: false, message: "Use at most eight comma-separated tags, each no longer than 40 characters."};
  }
  const checked = evaluateArticle({title, summary, body, keyword, tags});
  if (!isArticleHtmlWithinBudget(checked.article.body)) {
    return {ok: false, message: "Sanitized HTML exceeds the 60 KB safety limit."};
  }
  if (checked.article.body.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, "").trim().length < 20) {
    return {ok: false, message: "Add substantive readable body text before saving."};
  }
  const next: EditableDraftFields = {
    title: checked.article.title, summary: checked.article.summary,
    body: checked.article.body, keyword: checked.article.keyword,
    tags: checked.article.tags.join(",")
  };
  return db.$transaction(async tx => {
    const active = await tx.storeConfig.updateMany({
      where: {shop}, data: {updatedAt: new Date()}
    });
    if (active.count !== 1) {
      return {ok: false, message: "Store disconnected. No draft was changed."};
    }
    const current = await tx.articleDraft.findFirst({
      where: {id: draftId, shop, status: {in: ["ready", "needs_review"]}},
      select: {id: true, status: true, title: true, summary: true, body: true, tags: true, keyword: true}
    });
    if (!current) {
      return {ok: false, message: "Only unpublished drafts awaiting review can be edited."};
    }
    if (editorialEditDigest(current) !== expectedDigest) {
      return {ok: false, message: "This draft changed since you opened it. Refresh before editing again."};
    }
    if (fields.every(key => current[key] === next[key])) {
      return {ok: true, message: "No changes to save. Existing review remains unchanged."};
    }
    const updated = await tx.articleDraft.updateMany({
      where: {id: draftId, shop, status: current.status,
        title: current.title, summary: current.summary, body: current.body,
        tags: current.tags, keyword: current.keyword},
      data: {...next, seoScore: checked.score,
        status: checked.score >= 70 ? "ready" : "needs_review",
        reviewNotes: checked.warnings.join("\n")}
    });
    if (updated.count !== 1) {
      return {ok: false, message: "Draft changed during save. Refresh and retry."};
    }
    // Preserve the existing review row for historical metrics, but revoke
    // its publication authorization even for a keyword-only edit.
    await tx.editorialReview.updateMany({
      where: {shop, draftId, decision: "usable"},
      data: {contentDigest: ""}
    });
    return {ok: true, message: "Corrections saved as an unpublished draft. Any previous usable review must be renewed before publishing."};
  });
}
