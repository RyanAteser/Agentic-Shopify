import db from "../db.server";

/** Bound read costs on the merchant dashboard. Oversized cohorts abstain. */
export const MAX_REVIEW_COHORT_DRAFTS = 1000;

export type CohortDraft = { id: string; status: string };
export type CohortReview = { draftId: string; decision: string };

export function summarizeDraftReviewCoverage(drafts: CohortDraft[], reviews: CohortReview[]) {
  const ids = new Set(drafts.map(draft => draft.id));
  if (ids.size !== drafts.length || drafts.some(draft => !draft.id)) {
    throw new Error("Duplicate or missing editorial draft identifier");
  }
  const decisions = new Map<string, string>();
  for (const review of reviews) {
    if (!ids.has(review.draftId) || decisions.has(review.draftId) ||
        !["usable", "rejected"].includes(review.decision)) {
      throw new Error("Invalid editorial cohort review");
    }
    decisions.set(review.draftId, review.decision);
  }
  const usable = [...decisions.values()].filter(value => value === "usable").length;
  const rejected = decisions.size - usable;
  const publishedWithoutReview = drafts.filter(draft =>
    draft.status === "published" && !decisions.has(draft.id)
  ).length;
  return {
    drafts: drafts.length,
    reviewed: decisions.size,
    unreviewed: drafts.length - decisions.size,
    usable, rejected, publishedWithoutReview,
    coveragePct: drafts.length >= 5 ? decisions.size / drafts.length * 100 : null,
  };
}

/**
 * Drafts are selected by creation date; their recorded review can have happened
 * later. This is not a review-action cohort, a current approval count or an
 * acceptance rate. All queries are scoped to the authenticated shop.
 *
 * No partial percentage is returned if the bounded query cannot cover the
 * entire creation-date cohort. No buyer, order or article content is loaded.
 */
export async function loadDraftReviewCoverage(shop: string, since: Date, now: Date) {
  const drafts = await db.articleDraft.findMany({
    where: { shop, createdAt: { gte: since, lt: now } },
    select: { id: true, status: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_REVIEW_COHORT_DRAFTS + 1,
  });
  if (drafts.length > MAX_REVIEW_COHORT_DRAFTS) {
    return { available: false as const, reason: "cohort-too-large" as const };
  }
  const reviews = drafts.length ? await db.editorialReview.findMany({
    where: { shop, draftId: { in: drafts.map(draft => draft.id) } },
    select: { draftId: true, decision: true },
  }) : [];
  return {
    available: true as const,
    ...summarizeDraftReviewCoverage(drafts, reviews),
  };
}
