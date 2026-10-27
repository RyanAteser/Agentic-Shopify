export type EditorialStatusCount = { status: string; count: number };

export type EditorialCohort = {
  requests: number;
  failedJobs: number;
  uncertainJobs: number;
  drafts: number;
  published: number;
  rejected: number;
  awaitingReview: number;
  reconciliation: number;
  resolved: number;
  publishedAmongResolvedPct: number | null;
};

function countsByStatus(rows: EditorialStatusCount[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error("Invalid editorial aggregate count");
    }
    counts.set(row.status, (counts.get(row.status) ?? 0) + row.count);
  }
  return counts;
}

/**
 * Status snapshot for drafts CREATED in a reporting window. A draft can be
 * published after that window, so this is not a period publication count.
 * Job requests and drafts are independent creation-date cohorts: never divide
 * their totals to infer delivery success. No merchant revenue is inferred.
 */
export function summarizeEditorialCohort(
  jobRows: EditorialStatusCount[], draftRows: EditorialStatusCount[]
): EditorialCohort {
  const jobs = countsByStatus(jobRows);
  const drafts = countsByStatus(draftRows);
  const sum = (rows: Map<string, number>) =>
    [...rows.values()].reduce((total, count) => total + count, 0);
  const published = drafts.get("published") ?? 0;
  const rejected = drafts.get("rejected") ?? 0;
  const resolved = published + rejected;
  return {
    requests: sum(jobs),
    failedJobs: jobs.get("failed") ?? 0,
    uncertainJobs: jobs.get("dispatch_uncertain") ?? 0,
    drafts: sum(drafts),
    published,
    rejected,
    awaitingReview: (drafts.get("ready") ?? 0) + (drafts.get("needs_review") ?? 0),
    reconciliation: (drafts.get("needs_reconciliation") ?? 0) + (drafts.get("publishing") ?? 0),
    resolved,
    publishedAmongResolvedPct: resolved >= 5 ? published / resolved * 100 : null,
  };
}

/** Voluntary review-decision cohort, independent of draft creation dates. */
export type ReviewAggregateRow = {
  decision: string; count: number; minutesSamples: number; minutesTotal: number;
};
export function summarizeEditorialReviews(rows: ReviewAggregateRow[]) {
  let usable = 0, rejected = 0, minutesSamples = 0, minutesTotal = 0;
  for (const row of rows) {
    if (!["usable", "rejected"].includes(row.decision) ||
        !Number.isSafeInteger(row.count) || row.count < 0 ||
        !Number.isSafeInteger(row.minutesSamples) || row.minutesSamples < 0 ||
        row.minutesSamples > row.count ||
        !Number.isSafeInteger(row.minutesTotal) || row.minutesTotal < 0 ||
        (row.minutesSamples === 0 && row.minutesTotal !== 0)) {
      throw new Error("Invalid editorial review aggregate");
    }
    if (row.decision === "usable") usable += row.count;
    else rejected += row.count;
    minutesSamples += row.minutesSamples;
    minutesTotal += row.minutesTotal;
  }
  const reviewed = usable + rejected;
  return {
    usable, rejected, reviewed, minutesSamples,
    usableAmongReviewedPct: reviewed >= 5 ? usable / reviewed * 100 : null,
    meanReportedMinutes: minutesSamples ? minutesTotal / minutesSamples : null
  };
}
