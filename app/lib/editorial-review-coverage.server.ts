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

/** Age of drafts without an explicit recorded review, not necessarily waiting in the UI.
 * Snapshots are bounded and calculated against the same reporting instant.
 * Review status can be stale after edits; this is a backlog diagnostic only.
 */
export function summarizeUnreviewedAge(
  drafts: Array<CohortDraft & {createdAt: Date}>,
  reviews: CohortReview[],
  now: Date
) {
  const instant=now.getTime();
  if(!Number.isFinite(instant))throw new Error("Invalid editorial reporting instant");
  const reviewed=new Set(reviews.map(review=>review.draftId));
  const seen=new Set<string>();
  let aged7Days=0, aged14Days=0, oldestUnreviewedDays: number|null=null;
  let actionableUnreviewed=0, actionableAged7Days=0, actionableAged14Days=0;
  let oldestActionableDays: number|null=null;
  for(const draft of drafts) {
    if(!draft.id||seen.has(draft.id))throw new Error("Duplicate or missing editorial draft identifier");
    seen.add(draft.id);
    const created=draft.createdAt.getTime();
    if(!Number.isFinite(created)||created>instant)throw new Error("Invalid editorial draft creation date");
    if(reviewed.has(draft.id))continue;
    const ageDays=Math.floor((instant-created)/86400000);
    if(ageDays>=7)aged7Days++;
    if(ageDays>=14)aged14Days++;
    oldestUnreviewedDays=Math.max(oldestUnreviewedDays??0,ageDays);
    // Only ready/needs_review represent an actionable editorial queue.
    // Published/rejected/reconciliation records without reviews are historical
    // evidence gaps or operational exceptions, not pending merchant decisions.
    if(draft.status==="ready"||draft.status==="needs_review") {
      actionableUnreviewed++;
      if(ageDays>=7)actionableAged7Days++;
      if(ageDays>=14)actionableAged14Days++;
      oldestActionableDays=Math.max(oldestActionableDays??0,ageDays);
    }
  }
  if(reviews.some(review=>!seen.has(review.draftId)))throw new Error("Foreign editorial review");
  return {aged7Days,aged14Days,oldestUnreviewedDays,
    actionableUnreviewed,actionableAged7Days,actionableAged14Days,oldestActionableDays};
}

/** Elapsed time from draft creation to the *latest recorded* review decision.
 * Review rows can be renewed after edits, so this is not first-response time.
 * No duration is inferred from missing reviews or from the draft status.
 */
export function summarizeRecordedReviewElapsed(
  drafts: Array<CohortDraft & {createdAt:Date}>,
  reviews: Array<CohortReview & {reviewedAt:Date}>,
  now:Date
) {
  const instant=now.getTime();
  if(!Number.isFinite(instant))throw new Error("Invalid editorial reporting instant");
  const created=new Map<string,number>();
  for(const draft of drafts) {
    const at=draft.createdAt.getTime();
    if(!draft.id||created.has(draft.id)||!Number.isFinite(at)||at>instant)
      throw new Error("Invalid editorial cohort draft timestamp or identifier");
    created.set(draft.id,at);
  }
  const seen=new Set<string>();
  const elapsed:number[]=[];
  let invalidIntervals=0;
  for(const review of reviews) {
    if(!created.has(review.draftId)||seen.has(review.draftId)||
      !["usable","rejected"].includes(review.decision))
      throw new Error("Invalid editorial cohort review");
    seen.add(review.draftId);
    const at=review.reviewedAt.getTime();
    if(!Number.isFinite(at)||at>instant||at<created.get(review.draftId)!) {
      invalidIntervals++;
      continue;
    }
    elapsed.push((at-created.get(review.draftId)!)/3600000);
  }
  elapsed.sort((a,b)=>a-b);
  // Abstain if any recorded review is inconsistent, or fewer than five
  // valid decisions exist. Never silently discard bad records to improve KPI.
  const comparable=invalidIntervals===0&&elapsed.length>=5;
  const median=comparable?(elapsed.length%2
    ?elapsed[(elapsed.length-1)/2]
    :(elapsed[elapsed.length/2-1]+elapsed[elapsed.length/2])/2):null;
  const p90=comparable?elapsed[Math.ceil(elapsed.length*0.9)-1]:null;
  return {reviewElapsedSamples:elapsed.length,reviewElapsedInvalid:invalidIntervals,
    medianRecordedReviewHours:median,p90RecordedReviewHours:p90};
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
    select: { id: true, status: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_REVIEW_COHORT_DRAFTS + 1,
  });
  if (drafts.length > MAX_REVIEW_COHORT_DRAFTS) {
    return { available: false as const, reason: "cohort-too-large" as const };
  }
  const reviews = drafts.length ? await db.editorialReview.findMany({
    where: { shop, draftId: { in: drafts.map(draft => draft.id) } },
    select: { draftId: true, decision: true, reviewedAt: true },
  }) : [];
  return {
    available: true as const,
    ...summarizeDraftReviewCoverage(drafts, reviews),
    ...summarizeUnreviewedAge(drafts, reviews, now),
    ...summarizeRecordedReviewElapsed(drafts, reviews, now),
  };
}
