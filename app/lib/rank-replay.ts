import { buildRankTasks, rankIncidentKey, sameRankTarget, type RankLike } from "./manager";
import { assertRankingTargetsForPrimaryDomain, assertUniqueRankingObservations, parseRanking } from "./seo";

/**
 * Offline, shop-scoped SERP alert evaluation. No database, network or merchant
 * mutation. A two-snapshot reference is deliberately NOT a claim about an
 * exact historical production algorithm or the truth of a traffic decline.
 */
type LabeledIncident = {
  keyword: string; country: string; device: string; engine: string;
  targetUrl: string; useful: boolean;
};
type ReplayInput = {
  primaryHost: string;
  observations: unknown[];
  labels?: LabeledIncident[];
};
type AlertCounts = {
  incidentDays: number;
  uniqueIncidents: number;
  labeledUseful: number;
  labeledNotUseful: number;
  unlabeled: number;
  usefulAmongLabeledPct: number | null;
};

function marketKey(row: RankLike): string {
  return [row.keyword, row.country, row.device, row.engine].join("|");
}
function naiveTwoSnapshotReference(rows: RankLike[], at: Date): string | null {
  const latest = rows[rows.length - 1], previous = rows[rows.length - 2];
  if (!latest || !previous || latest.position === null || previous.position === null ||
      !sameRankTarget(latest.targetUrl, previous.targetUrl) ||
      latest.position - previous.position < 3 ||
      at.getTime() - latest.observedAt.getTime() > 14 * 86400000 ||
      latest.observedAt.getTime() - previous.observedAt.getTime() > 28 * 86400000) {
    return null;
  }
  return rankIncidentKey(marketKey(latest), latest.targetUrl);
}
function counts(days: Set<string>, labels: Map<string, boolean>): AlertCounts {
  const incidents = new Set([...days].map(value => value.slice(11)));
  let labeledUseful = 0, labeledNotUseful = 0, unlabeled = 0;
  for (const incident of incidents) {
    const useful = labels.get(incident);
    if (useful === true) labeledUseful++;
    else if (useful === false) labeledNotUseful++;
    else unlabeled++;
  }
  const n = labeledUseful + labeledNotUseful;
  return {
    incidentDays: days.size, uniqueIncidents: incidents.size,
    labeledUseful, labeledNotUseful, unlabeled,
    usefulAmongLabeledPct: n ? Math.round(10000 * labeledUseful / n) / 100 : null
  };
}

export function replayRankingAlerts(raw: unknown, now = new Date()) {
  if (!Number.isFinite(now.getTime()) || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Replay requires an object and a valid evaluation time");
  }
  const input = raw as ReplayInput;
  if (typeof input.primaryHost !== "string" || !Array.isArray(input.observations) ||
      input.observations.length === 0 || input.observations.length > 5000) {
    throw new Error("Replay requires one primary host and 1-5000 observations");
  }
  const observations = input.observations.map(row => parseRanking(row, now));
  assertUniqueRankingObservations(observations);
  assertRankingTargetsForPrimaryDomain(observations, input.primaryHost);
  if (observations.some(row => row.observedAt.getTime() > now.getTime())) {
    throw new Error("Future observations cannot enter an offline replay");
  }
  observations.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const groups = new Map<string, RankLike[]>();
  const knownIncidents = new Set<string>();
  for (const row of observations) {
    const key = marketKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
    if (row.position !== null) knownIncidents.add(rankIncidentKey(key, row.targetUrl));
  }
  if (input.labels !== undefined && (!Array.isArray(input.labels) || input.labels.length > 5000)) {
    throw new Error("Replay labels must be an array of at most 5000 entries");
  }
  const labels = new Map<string, boolean>();
  for (const label of input.labels || []) {
    if (!label || typeof label !== "object" || typeof label.useful !== "boolean" ||
        typeof label.keyword !== "string" || typeof label.country !== "string" ||
        typeof label.device !== "string" || typeof label.engine !== "string" ||
        typeof label.targetUrl !== "string") {
      throw new Error("Malformed merchant usefulness label");
    }
    const key = [label.keyword.trim().toLowerCase().replace(/\s+/g, " "),
      label.country, label.device, label.engine].join("|");
    const incident = rankIncidentKey(key, label.targetUrl);
    if (!knownIncidents.has(incident) || labels.has(incident)) {
      throw new Error("Duplicate or unrecognized merchant usefulness label");
    }
    labels.set(incident, label.useful);
  }
  // One end-of-UTC-day checkpoint per date with actual observations.
  // Markets without a new scrape on that date do not create repeated alerts.
  const days = [...new Set(observations.map(row => row.observedAt.toISOString().slice(0, 10)))].sort();
  const referenceDays = new Set<string>(), confirmedDays = new Set<string>();
  for (const day of days) {
    const end = new Date(day + "T23:59:59.999Z");
    const at = end.getTime() > now.getTime() ? now : end;
    for (const market of groups.values()) {
      const history = market.filter(row => row.observedAt.getTime() <= at.getTime());
      if (!history.length || history[history.length - 1].observedAt.toISOString().slice(0, 10) !== day) continue;
      const reference = naiveTwoSnapshotReference(history, at);
      if (reference) referenceDays.add(day + ":" + reference);
      for (const task of buildRankTasks(history, at)) {
        confirmedDays.add(day + ":" + task.sourceKey);
      }
    }
  }
  const referenceOnly = [...referenceDays].filter(key => !confirmedDays.has(key)).length;
  const confirmedOnly = [...confirmedDays].filter(key => !referenceDays.has(key)).length;
  return {
    evaluationTime: now.toISOString(),
    observations: observations.length,
    notFoundObservations: observations.filter(row => row.position === null).length,
    markets: groups.size,
    observationDays: days.length,
    labelsSupplied: labels.size,
    referenceTwoSnapshot: counts(referenceDays, labels),
    confirmedThreeDay: counts(confirmedDays, labels),
    comparison: {
      referenceOnlyIncidentDays: referenceOnly,
      confirmedOnlyIncidentDays: confirmedOnly,
      bothIncidentDays: referenceDays.size - referenceOnly
    },
    caveat: "Reference is a naive two-snapshot comparator, not historical production. Alert counts are not false positives, GSC traffic loss, SEO lift or revenue. Merchant usefulness labels are optional, subjective and potentially selected."
  };
}
