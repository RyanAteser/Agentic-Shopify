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
/**
 * A market/page can fall, recover and fall again within one export. Comparing
 * the first alert across the entire export can pair unrelated declines.
 * Partition the chronological observation stream without looking ahead:
 * a sampled return to within two positions of the pre-drop best rank, a page
 * change, a missing result or a >28-day gap begins a new comparison episode.
 * These are *observational* boundaries, not verified GSC recoveries.
 */
function episodeOrdinals(rows: RankLike[]): Map<RankLike, number> {
  const ordinals = new Map<RankLike, number>();
  let ordinal = 0, anchor: number | null = null, dropped = false;
  let previous: RankLike | undefined;
  for (const row of rows) {
    const incomparable = previous && (
      row.position === null || previous.position === null ||
      !sameRankTarget(row.targetUrl, previous.targetUrl) ||
      row.observedAt.getTime() - previous.observedAt.getTime() > 28 * 86400000
    );
    if (incomparable) {
      ordinal++;
      anchor = row.position;
      dropped = false;
    } else if (!previous) {
      anchor = row.position;
    } else if (anchor !== null && row.position !== null) {
      if (dropped && row.position <= anchor + 2) {
        ordinal++;
        anchor = row.position;
        dropped = false;
      } else if (!dropped) {
        if (row.position < anchor) anchor = row.position;
        else if (row.position >= anchor + 3) dropped = true;
      }
    }
    ordinals.set(row, ordinal);
    previous = row;
  }
  return ordinals;
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

/**
 * Compare first alert dates by stable incident identity, not exact alert-day.
 * Two rules can detect the same problem on different dates; treating that as
 * two disjoint alerts overstates disagreement and hides detection delay.
 */
function firstIncidentDays(days: Set<string>): Map<string, string> {
  const first = new Map<string, string>();
  for (const value of days) {
    const day = value.slice(0, 10);
    const incident = value.slice(11);
    const previous = first.get(incident);
    if (!previous || day < previous) first.set(incident, day);
  }
  return first;
}
function compareFirstAlerts(referenceDays: Set<string>, confirmedDays: Set<string>) {
  const reference = firstIncidentDays(referenceDays);
  const confirmed = firstIncidentDays(confirmedDays);
  const lags: number[] = [];
  let confirmedEarlier = 0, confirmedLater = 0, sameDay = 0;
  for (const [incident, confirmedDate] of confirmed) {
    const referenceDate = reference.get(incident);
    if (!referenceDate) continue;
    const lag = (Date.parse(confirmedDate + "T00:00:00Z") -
      Date.parse(referenceDate + "T00:00:00Z")) / 86400000;
    lags.push(lag);
    if (lag < 0) confirmedEarlier++;
    else if (lag > 0) confirmedLater++;
    else sameDay++;
  }
  lags.sort((a, b) => a - b);
  const middle = Math.floor(lags.length / 2);
  return {
    referenceOnlyIncidents: reference.size - lags.length,
    confirmedOnlyIncidents: confirmed.size - lags.length,
    bothIncidents: lags.length,
    confirmedEarlierIncidents: confirmedEarlier,
    confirmedLaterIncidents: confirmedLater,
    sameDayIncidents: sameDay,
    medianConfirmedLagDays: lags.length
      ? lags.length % 2 ? lags[middle] : (lags[middle - 1] + lags[middle]) / 2
      : null
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
  const referenceEpisodeDays = new Set<string>(), confirmedEpisodeDays = new Set<string>();
  const episodes = new Map<string, Map<RankLike, number>>();
  for (const [key, rows] of groups) episodes.set(key, episodeOrdinals(rows));
  for (const day of days) {
    const end = new Date(day + "T23:59:59.999Z");
    const at = end.getTime() > now.getTime() ? now : end;
    for (const [marketKey, market] of groups) {
      const history = market.filter(row => row.observedAt.getTime() <= at.getTime());
      const latest = history[history.length - 1];
      if (!latest || latest.observedAt.toISOString().slice(0, 10) !== day) continue;
      const episode = episodes.get(marketKey)!.get(latest)!;
      const reference = naiveTwoSnapshotReference(history, at);
      if (reference) {
        referenceDays.add(day + ":" + reference);
        referenceEpisodeDays.add(day + ":" + reference + ":episode:" + episode);
      }
      for (const task of buildRankTasks(history, at)) {
        confirmedDays.add(day + ":" + task.sourceKey);
        confirmedEpisodeDays.add(day + ":" + task.sourceKey + ":episode:" + episode);
      }
    }
  }
  const referenceOnly = [...referenceDays].filter(key => !confirmedDays.has(key)).length;
  const confirmedOnly = [...confirmedDays].filter(key => !referenceDays.has(key)).length;
  const incidentComparison = compareFirstAlerts(referenceDays, confirmedDays);
  const episodeComparison = compareFirstAlerts(referenceEpisodeDays, confirmedEpisodeDays);
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
      bothIncidentDays: referenceDays.size - referenceOnly,
      referenceOnlyIncidents: incidentComparison.referenceOnlyIncidents,
      confirmedOnlyIncidents: incidentComparison.confirmedOnlyIncidents,
      bothIncidents: incidentComparison.bothIncidents,
      referenceOnlyEpisodes: episodeComparison.referenceOnlyIncidents,
      confirmedOnlyEpisodes: episodeComparison.confirmedOnlyIncidents,
      bothEpisodes: episodeComparison.bothIncidents,
      confirmedEarlierEpisodes: episodeComparison.confirmedEarlierIncidents,
      confirmedLaterEpisodes: episodeComparison.confirmedLaterIncidents,
      sameDayEpisodes: episodeComparison.sameDayIncidents,
      medianConfirmedEpisodeLagDays: episodeComparison.medianConfirmedLagDays
    },
    caveat: "Reference is a naive two-snapshot comparator, not historical production. Repeated market/page declines are split into observational episodes after a sampled recovery, URL change, missing result or >28-day gap; these are not verified GSC recoveries. Episode first-alert UTC-day lag is descriptive, not false-positive rates, verified traffic loss, SEO lift or revenue. Optional usefulness labels apply to stable market/page identities, not individual recurring episodes, and may be selected."
  };
}
