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
  resolvedCoveragePct: number | null;
  publishedAmongAllDraftsPct: number | null;
};

function countsByStatus(rows: EditorialStatusCount[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error("Invalid editorial aggregate count");
    }
    const total=(counts.get(row.status) ?? 0) + row.count;
    if(!Number.isSafeInteger(total))throw new Error("Editorial aggregate exceeds safe integer range");
    counts.set(row.status,total);
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
    [...rows.values()].reduce((total, count) => {
      const next=total+count;
      if(!Number.isSafeInteger(next))throw new Error("Editorial cohort total exceeds safe integer range");
      return next;
    }, 0);
  const published = drafts.get("published") ?? 0;
  const rejected = drafts.get("rejected") ?? 0;
  const resolved = published + rejected;
  const totalDrafts = sum(drafts);
  if(!Number.isSafeInteger(resolved)||resolved>totalDrafts)throw new Error("Invalid editorial resolved count");
  return {
    requests: sum(jobs),
    failedJobs: jobs.get("failed") ?? 0,
    uncertainJobs: jobs.get("dispatch_uncertain") ?? 0,
    drafts: totalDrafts,
    published,
    rejected,
    awaitingReview: (drafts.get("ready") ?? 0) + (drafts.get("needs_review") ?? 0),
    reconciliation: (drafts.get("needs_reconciliation") ?? 0) + (drafts.get("publishing") ?? 0),
    resolved,
    publishedAmongResolvedPct: resolved >= 5 ? published / resolved * 100 : null,
    // Denominator visibility prevents an attractive resolved-only rate from
    // concealing a backlog. These are snapshots, not conversion or retention.
    resolvedCoveragePct: totalDrafts >= 5 ? resolved / totalDrafts * 100 : null,
    publishedAmongAllDraftsPct: totalDrafts >= 5 ? published / totalDrafts * 100 : null,
  };
}

/** Voluntary review-decision cohort, independent of draft creation dates. */
export type ReviewAggregateRow = {
  decision: string; count: number; minutesSamples: number; minutesTotal: number;
};
export function summarizeEditorialReviews(rows: ReviewAggregateRow[]) {
  let usable = 0, rejected = 0, minutesSamples = 0, minutesTotal = 0;
  const seen=new Set<string>();
  for (const row of rows) {
    if (!["usable", "rejected"].includes(row.decision) ||
        seen.has(row.decision) ||
        !Number.isSafeInteger(row.count) || row.count < 0 ||
        !Number.isSafeInteger(row.minutesSamples) || row.minutesSamples < 0 ||
        row.minutesSamples > row.count ||
        !Number.isSafeInteger(row.minutesTotal) || row.minutesTotal < 0 ||
        (row.minutesSamples === 0 && row.minutesTotal !== 0)) {
      throw new Error("Invalid editorial review aggregate");
    }
    seen.add(row.decision);
    if (row.decision === "usable") usable += row.count;
    else rejected += row.count;
    minutesSamples += row.minutesSamples;
    minutesTotal += row.minutesTotal;
    if (![usable,rejected,minutesSamples,minutesTotal].every(Number.isSafeInteger)) {
      throw new Error("Editorial review aggregate exceeds safe integer range");
    }
  }
  const reviewed = usable + rejected;
  if (!Number.isSafeInteger(reviewed)) {
    throw new Error("Editorial review aggregate exceeds safe integer range");
  }
  const minutesMissing=reviewed-minutesSamples;
  // Reporting is voluntary. A small or poorly covered subset can make an
  // attractive mean look representative of the entire review population.
  const minutesCoveragePct=reviewed>=5 ? 100*minutesSamples/reviewed : null;
  const comparableMinutes=reviewed>=5 && minutesSamples>=5 &&
    minutesSamples/reviewed>=0.8;
  return {
    usable, rejected, reviewed, minutesSamples, minutesMissing,
    minutesCoveragePct,
    usableAmongReviewedPct: reviewed >= 5 ? usable / reviewed * 100 : null,
    meanReportedMinutes: comparableMinutes ? minutesTotal / minutesSamples : null,
    minutesInterpretation: reviewed<5 ? "insufficient-reviews" :
      minutesSamples<5 ? "insufficient-time-reports" :
      minutesSamples/reviewed<0.8 ? "low-reporting-coverage" :
      "descriptive-self-reported"
  };
}
