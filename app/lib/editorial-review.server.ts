import db from "../db.server";
import { publicationReviewDigest, reviewFormDigest } from "./editorial-review-integrity";

export type ReviewDecision = "usable" | "rejected";

/** Optional self-reported minutes, never inferred from clicks. */
export function parseReviewMinutes(raw: FormDataEntryValue | null): number | null {
  if (raw === null || String(raw).trim() === "") return null;
  const value = String(raw).trim();
  if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 240) {
    throw new Error("Review minutes must be a whole number from 1 to 240.");
  }
  return Number(value);
}

/**
 * Review does not authorize Shopify publishing. Lock store configuration first,
 * matching uninstall/redaction order, so late reviews cannot resurrect data.
 * Unique(shop,draftId) prevents duplicate outcomes even across concurrent retries.
 */
export async function recordEditorialReview(
  shop: string, draftId: string, decision: ReviewDecision,
  reviewMinutes: number | null, expectedFormDigest: string, feedback = ""
): Promise<{ok: boolean; message: string}> {
  if (!shop || !draftId || !["usable", "rejected"].includes(decision)) {
    return {ok: false, message: "Invalid review request."};
  }
  // A review is a decision about what was displayed, not the latest unseen edit.
  // This is an optimistic version, not an authentication credential.
  if (!/^[a-f0-9]{64}$/.test(expectedFormDigest)) {
    return {ok: false, message: "Review form is missing or outdated. Refresh the draft."};
  }
  if (reviewMinutes !== null &&
      (!Number.isSafeInteger(reviewMinutes) || reviewMinutes < 1 || reviewMinutes > 240)) {
    return {ok: false, message: "Review minutes must be between 1 and 240."};
  }
  const notes = feedback.trim();
  if (notes.length > 1000) return {ok: false, message: "Feedback is too long."};
  if (decision === "rejected" && !notes) {
    return {ok: false, message: "Please explain why the draft is not usable."};
  }
  try {
    return await db.$transaction(async tx => {
      const store = await tx.storeConfig.updateMany({
        where: {shop}, data: {updatedAt: new Date()}
      });
      if (store.count !== 1) return {ok: false, message: "Store is no longer connected."};
      const destination = await tx.storeConfig.findUniqueOrThrow({
        where: {shop}, select: {blogId: true, authorName: true}
      });
      const draft = await tx.articleDraft.findFirst({
        where: {id: draftId, shop, status: {in: ["ready", "needs_review"]}},
        select: {id: true, status: true, title: true, body: true, summary: true, tags: true, keyword: true}
      });
      if (!draft) return {ok: false, message: "Draft is not eligible for review."};
      if (decision === "usable" && draft.status !== "ready") {
        return {ok: false, message: "This draft still needs corrections before it can be marked usable."};
      }
      if (reviewFormDigest(draft, destination) !== expectedFormDigest) {
        return {ok: false, message: "Draft or publication destination changed since you opened it. Refresh and review again."};
      }
      const digest = publicationReviewDigest(draft, destination);
      const previous = await tx.editorialReview.findUnique({
        where: {shop_draftId: {shop, draftId}},
        select: {id: true, decision: true, contentDigest: true}
      });
      // A legacy or stale usable review can be renewed after the merchant
      // explicitly inspects the new payload. Rejections stay final.
      const renewal = !!previous && previous.decision === "usable" &&
        decision === "usable" && previous.contentDigest !== digest;
      if (previous && !renewal) {
        return {ok: false, message: "A review is already recorded for this draft."};
      }
      const claimed = await tx.articleDraft.updateMany({
        where: {id: draftId, shop, status: draft.status,
          title: draft.title, body: draft.body, summary: draft.summary,
          tags: draft.tags, keyword: draft.keyword},
        data: decision === "rejected"
          ? {status: "rejected", reviewNotes: notes}
          : {updatedAt: new Date()}
      });
      if (claimed.count !== 1) return {ok: false, message: "Draft changed during review."};
      if (renewal) {
        await tx.editorialReview.update({
          where: {shop_draftId: {shop, draftId}},
          data: {contentDigest: digest, reviewMinutes, reviewedAt: new Date(), feedback: ""}
        });
      } else {
        await tx.editorialReview.create({
          data: {shop, draftId, decision, contentDigest: decision === "usable" ? digest : "",
            reviewMinutes, feedback: decision === "rejected" ? notes : ""}
        });
      }
      return {ok: true, message: decision === "usable"
        ? (renewal
          ? "Usable review renewed for the current article. The article has NOT been published."
          : "Usable review recorded. The article has NOT been published.")
        : "Rejection and review feedback recorded."};
    });
  } catch (error) {
    if ((error as {code?: string})?.code === "P2002") {
      return {ok: false, message: "A review is already recorded for this draft."};
    }
    throw error;
  }
}
