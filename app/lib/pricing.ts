// Public plan metadata only. Paid plans are not yet activated or billable.
export const FREE_LIFETIME_GENERATIONS = 3;

export const PROPOSED_PLANS = [
  { id: "free", monthlyUsd: 0, generations: 3, renewal: "lifetime" },
  { id: "starter", monthlyUsd: 19, generations: 15, renewal: "monthly" },
  { id: "growth", monthlyUsd: 39, generations: 50, renewal: "monthly" },
  { id: "scale", monthlyUsd: 99, generations: 150, renewal: "monthly" },
] as const;
