#!/usr/bin/env node
// Offline, read-only pilot scoring. No merchant identifiers or credentials required.
// Usage: node scripts/seo-reviewer-evaluation.mjs assessments.json
// Input: [{caseId, baseline:"change"|"no_change"|"abstain", guarded:"change"|"no_change"|"abstain", adjudicated:"change"|"no_change"|"unknown"}]
import { readFileSync } from "node:fs";

const decisions = new Set(["change", "no_change", "abstain"]);
const truths = new Set(["change", "no_change", "unknown"]);

export function scoreAssessments(rows) {
  if (!Array.isArray(rows)) throw new Error("Expected an array");
  const seen = new Set();
  const result = { total: rows.length, adjudicated: 0, disagreement: 0, baselineAbstentions: 0, guardedAbstentions: 0, baselineErrors: 0, guardedErrors: 0, corrected: 0, regressed: 0 };
  for (const row of rows) {
    if (!row || typeof row.caseId !== "string" || !row.caseId.trim() || seen.has(row.caseId) ||
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
    if (baseError && !guardError && row.guarded !== "abstain") result.corrected++;
    if (!baseError && guardError) result.regressed++;
  }
  return { ...result, evidenceSufficient: result.adjudicated >= 30,
    note: "Descriptive counts only. Abstentions are reported separately and are not counted as correct; unknown adjudications are excluded from error denominators." };
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
      process.stdout.write(JSON.stringify(scoreAssessments(JSON.parse(readFileSync(process.argv[2], "utf8"))), null, 2) + "\n");
    }
  } catch (error) { process.stderr.write(String(error) + "\n"); process.exitCode = 1; }
}
