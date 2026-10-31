import test from "node:test";
import assert from "node:assert/strict";
import { scoreAssessments } from "../scripts/seo-reviewer-evaluation.mjs";

test("paired decisions count corrections, regressions and abstentions separately", () => {
  const score = scoreAssessments([
    { caseId: "1", baseline: "change", guarded: "no_change", adjudicated: "no_change" },
    { caseId: "2", baseline: "no_change", guarded: "change", adjudicated: "no_change" },
    { caseId: "3", baseline: "change", guarded: "abstain", adjudicated: "unknown" }
  ]);
  assert.equal(score.total, 3);
  assert.equal(score.adjudicated, 2);
  assert.equal(score.corrected, 1);
  assert.equal(score.regressed, 1);
  assert.equal(score.guardedErrors, 1);
  assert.equal(score.guardedAbstentions, 1);
  assert.equal(score.evidenceSufficient, false);
});
test("rejects invalid and duplicate cases", () => {
  assert.throws(() => scoreAssessments([{ caseId: "a", baseline: "wrong", guarded: "change", adjudicated: "change" }]));
  const row = { caseId: "a", baseline: "change", guarded: "change", adjudicated: "change" };
  assert.throws(() => scoreAssessments([row, row]));
});

test("reports actionable denominators without rewarding abstention", () => {
  const score = scoreAssessments([
    {caseId:"a",baseline:"change",guarded:"abstain",adjudicated:"no_change"},
    {caseId:"b",baseline:"no_change",guarded:"no_change",adjudicated:"no_change"},
    {caseId:"c",baseline:"abstain",guarded:"change",adjudicated:"unknown"}
  ]);
  assert.equal(score.adjudicated, 2);
  assert.equal(score.baselineActionable, 2);
  assert.equal(score.guardedActionable, 1);
  assert.equal(score.baselineActionableCoverage, 1);
  assert.equal(score.guardedActionableCoverage, 0.5);
  assert.equal(score.baselineErrorRate, 0.5);
  assert.equal(score.guardedErrorRate, 0);
});
test("zero actionable cases return null rates, not fabricated zero error", () => {
  const score = scoreAssessments([{caseId:"a",baseline:"abstain",guarded:"abstain",adjudicated:"change"}]);
  assert.equal(score.baselineErrorRate, null);
  assert.equal(score.guardedErrorRate, null);
  assert.equal(score.baselineActionableCoverage, 0);
  assert.equal(score.guardedActionableCoverage, 0);
});
