import db from "../db.server";

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
  reviewMinutes: number | null, feedback = ""
): Promise<{ok: boolean; message: string}> {
  if (!shop || !draftId || !["usable", "rejected"].includes(decision)) {
    return {ok: false, message: "Invalid review request."};
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
      const draft = await tx.articleDraft.findFirst({
        where: {id: draftId, shop, status: {in: ["ready", "needs_review"]}},
        select: {id: true, status: true}
      });
      if (!draft) return {ok: false, message: "Draft is not eligible for review."};
      if (decision === "usable" && draft.status !== "ready") {
        return {ok: false, message: "This draft still needs corrections before it can be marked usable."};
      }
      const previous = await tx.editorialReview.findUnique({
        where: {shop_draftId: {shop, draftId}}, select: {id: true}
      });
      if (previous) return {ok: false, message: "A review is already recorded for this draft."};
      const claimed = await tx.articleDraft.updateMany({
        where: {id: draftId, shop, status: draft.status},
        data: decision === "rejected"
          ? {status: "rejected", reviewNotes: notes}
          : {updatedAt: new Date()}
      });
      if (claimed.count !== 1) return {ok: false, message: "Draft changed during review."};
      await tx.editorialReview.create({
        data: {shop, draftId, decision, reviewMinutes, feedback: decision === "rejected" ? notes : ""}
      });
      return {ok: true, message: decision === "usable"
        ? "Usable review recorded. The article has NOT been published."
        : "Rejection and review feedback recorded."};
    });
  } catch (error) {
    if ((error as {code?: string})?.code === "P2002") {
      return {ok: false, message: "A review is already recorded for this draft."};
    }
    throw error;
  }
}
