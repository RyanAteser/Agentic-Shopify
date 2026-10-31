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
