import test from "node:test";
import assert from "node:assert/strict";
import { scoreAssessments } from "../scripts/seo-reviewer-evaluation.mjs";

// Exhaustive single-case oracle: both arms share the same unknown truth.
// This guards against subtracting independently optimized marginal bounds.
const actions = ["change", "no_change", "abstain"];
const truths = ["change", "no_change"];
const error = (decision, truth) => Number(decision !== "abstain" && decision !== truth);

test("all 9 unknown-decision pairs have sharp joint identification bounds", () => {
  for (const baseline of actions) for (const guarded of actions) {
    const score = scoreAssessments([{caseId:"unknown_1",baseline,guarded,adjudicated:"unknown"}]);
    const possible = truths.map(truth => error(guarded,truth) - error(baseline,truth));
    assert.deepEqual(score.errorDifferenceBounds, [Math.min(...possible),Math.max(...possible)],
      `baseline=${baseline}, guarded=${guarded}`);
    assert.equal(score.evidenceSufficient,false);
  }
});

test("paired bounds compose additively across independent unknown cases", () => {
  const rows = [];
  for (const baseline of actions) for (const guarded of actions) {
    rows.push({caseId:`pair_${rows.length}`,baseline,guarded,adjudicated:"unknown"});
  }
  const score = scoreAssessments(rows);
  let min = 0, max = 0;
  for (const row of rows) {
    const possible = truths.map(truth => error(row.guarded,truth) - error(row.baseline,truth));
    min += Math.min(...possible);
    max += Math.max(...possible);
  }
  assert.deepEqual(score.errorDifferenceBounds,[min,max]);
  assert.equal(score.unknownAdjudications,9);
});

test("known cases have exact paired differences across all decisions and truths", () => {
  let index = 0;
  for (const baseline of actions) for (const guarded of actions) for (const truth of truths) {
    const score = scoreAssessments([{caseId:`known_${index++}`,baseline,guarded,adjudicated:truth}]);
    const difference = error(guarded,truth) - error(baseline,truth);
    assert.deepEqual(score.errorDifferenceBounds,[difference,difference]);
    assert.equal(score.guardedErrors-score.baselineErrors,difference);
  }
});
