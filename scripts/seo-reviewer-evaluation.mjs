#!/usr/bin/env node
// Offline, read-only pilot scoring. No merchant identifiers or credentials required.
// Usage: node scripts/seo-reviewer-evaluation.mjs assessments.json
// Input: [{caseId, baseline:"change"|"no_change"|"abstain", guarded:"change"|"no_change"|"abstain", adjudicated:"change"|"no_change"|"unknown"}]
import { readFileSync } from "node:fs";

const decisions = new Set(["change", "no_change", "abstain"]);
const truths = new Set(["change", "no_change", "unknown"]);
const allowedFields = new Set(["caseId", "baseline", "guarded", "adjudicated"]);
const MAX_CASES = 500;
const MAX_INPUT_BYTES = 1024 * 1024;

export function scoreAssessments(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_CASES) throw new Error("Expected at most 500 assessment rows");
  const seen = new Set();
  const result = { total: rows.length, adjudicated: 0, disagreement: 0, baselineAbstentions: 0, guardedAbstentions: 0, baselineErrors: 0, guardedErrors: 0, corrected: 0, regressed: 0, errorsAvoidedByAbstention: 0, correctDecisionsLostToAbstention: 0, pairedActionable: 0, pairedBaselineErrors: 0, pairedGuardedErrors: 0 };
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !allowedFields.has(key)) ||
        typeof row.caseId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(row.caseId) || seen.has(row.caseId) ||
        !decisions.has(row.baseline) || !decisions.has(row.guarded) || !truths.has(row.adjudicated))
      throw new Error("Invalid or duplicate assessment");
    seen.add(row.caseId);
    if (row.baseline !== row.guarded) result.disagreement++;
    if (row.baseline === "abstain") result.baselineAbstentions++;
    if (row.guarded === "abstain") result.guardedAbstentions++;
    if (row.adjudicated === "unknown") continue;
    result.adjudicated++;
    const baseError = row.baseline !== "abstain" && row.baseline !== row.adjudicated;
    const guardError = row.guarded !== "abstain" && row.guarded !== row.adjudicated;
    if (baseError) result.baselineErrors++;
    if (guardError) result.guardedErrors++;
    if (row.baseline !== "abstain" && row.guarded !== "abstain") {
      result.pairedActionable++;
      if (baseError) result.pairedBaselineErrors++;
      if (guardError) result.pairedGuardedErrors++;
    }
    if (baseError && row.guarded === "abstain") result.errorsAvoidedByAbstention++;
    if (row.baseline === row.adjudicated && row.guarded === "abstain") result.correctDecisionsLostToAbstention++;
    if (baseError && !guardError && row.guarded !== "abstain") result.corrected++;
    if (!baseError && guardError) result.regressed++;
  }
  const unknownAdjudications = result.total - result.adjudicated;
  const adjudicationCoverage = result.total ? result.adjudicated / result.total : null;
  // Conservative error bounds: every unknown actionable decision may be right or wrong.
  // These are identification bounds, not confidence intervals.
  const baselineUnknownActionable = rows.filter(row => row.adjudicated === "unknown" && row.baseline !== "abstain").length;
  const guardedUnknownActionable = rows.filter(row => row.adjudicated === "unknown" && row.guarded !== "abstain").length;
  const adjudicatedRows = rows.filter(row => row.adjudicated !== "unknown");
  const baselineActionable = adjudicatedRows.filter(row => row.baseline !== "abstain").length;
  const guardedActionable = adjudicatedRows.filter(row => row.guarded !== "abstain").length;
  const baselineActionableCoverage = result.adjudicated ? baselineActionable / result.adjudicated : null;
  const guardedActionableCoverage = result.adjudicated ? guardedActionable / result.adjudicated : null;
  const baselineErrorRate = baselineActionable ? result.baselineErrors / baselineActionable : null;
  const guardedErrorRate = guardedActionable ? result.guardedErrors / guardedActionable : null;
  const pairedBaselineErrorRate = result.pairedActionable ? result.pairedBaselineErrors / result.pairedActionable : null;
  const pairedGuardedErrorRate = result.pairedActionable ? result.pairedGuardedErrors / result.pairedActionable : null;
  const baselineErrorCountBounds = [result.baselineErrors, result.baselineErrors + baselineUnknownActionable];
  const guardedErrorCountBounds = [result.guardedErrors, result.guardedErrors + guardedUnknownActionable];
  // Joint identification bounds preserve the shared ground truth for each case.
  // Subtracting marginal extremes can invent impossible outcomes when arms agree.
  let differenceMin = result.guardedErrors - result.baselineErrors;
  let differenceMax = differenceMin;
  for (const row of rows) {
    if (row.adjudicated !== "unknown") continue;
    const possible = ["change", "no_change"].map(truth =>
      Number(row.guarded !== "abstain" && row.guarded !== truth) -
      Number(row.baseline !== "abstain" && row.baseline !== truth));
    differenceMin += Math.min(...possible);
    differenceMax += Math.max(...possible);
  }
  const errorDifferenceBounds = [differenceMin, differenceMax];
  return { ...result, unknownAdjudications, adjudicationCoverage, baselineUnknownActionable, guardedUnknownActionable, baselineErrorCountBounds, guardedErrorCountBounds, errorDifferenceBounds, pairedBaselineErrorRate, pairedGuardedErrorRate, baselineActionable, guardedActionable, baselineActionableCoverage, guardedActionableCoverage, baselineErrorRate, guardedErrorRate, evidenceSufficient: result.adjudicated >= 30 && unknownAdjudications === 0,
    note: "Descriptive counts only. Abstentions are reported separately and are not counted as correct; unknown adjudications are excluded from error denominators. Paired error rates include only cases where both arms act and may be selection-biased. Error count bounds include unknown adjudications as possibly right or wrong; joint difference bounds preserve paired decisions and are not confidence intervals. evidenceSufficient requires 30 adjudicated cases and no unknown adjudications, but is not a release decision." };
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  try {
    if (process.argv[2] === "--self-test") {
      const r = scoreAssessments([{caseId:"a",baseline:"change",guarded:"no_change",adjudicated:"no_change"},{caseId:"b",baseline:"no_change",guarded:"abstain",adjudicated:"unknown"}]);
      if (r.corrected !== 1 || r.adjudicated !== 1 || r.guardedAbstentions !== 1 || r.disagreement !== 2) throw new Error("Self-test failed");
      for (const invalid of [[{caseId:"x",baseline:"yes",guarded:"change",adjudicated:"change"}],[{caseId:"x",baseline:"change",guarded:"change",adjudicated:"change"},{caseId:"x",baseline:"change",guarded:"change",adjudicated:"change"}]]) {
        let rejected = false; try { scoreAssessments(invalid); } catch { rejected = true; }
        if (!rejected) throw new Error("Invalid input accepted");
      }
      process.stdout.write("self-test passed\n");
    } else {
      if (!process.argv[2]) throw new Error("Provide JSON assessment file or --self-test");
      const input = readFileSync(process.argv[2]);
      if (input.byteLength > MAX_INPUT_BYTES) throw new Error("Assessment file exceeds 1 MiB");
      process.stdout.write(JSON.stringify(scoreAssessments(JSON.parse(input.toString("utf8"))), null, 2) + "\n");
    }
  } catch (error) { process.stderr.write(String(error) + "\n"); process.exitCode = 1; }
}
