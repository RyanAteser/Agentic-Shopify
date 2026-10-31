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

test("distinguishes corrections from errors hidden by abstention", () => {
  const score = scoreAssessments([
    {caseId:"a",baseline:"change",guarded:"no_change",adjudicated:"no_change"},
    {caseId:"b",baseline:"change",guarded:"abstain",adjudicated:"no_change"},
    {caseId:"c",baseline:"no_change",guarded:"abstain",adjudicated:"no_change"},
    {caseId:"d",baseline:"no_change",guarded:"change",adjudicated:"no_change"},
    {caseId:"e",baseline:"abstain",guarded:"change",adjudicated:"change"}
  ]);
  assert.equal(score.corrected, 1);
  assert.equal(score.errorsAvoidedByAbstention, 1);
  assert.equal(score.correctDecisionsLostToAbstention, 1);
  assert.equal(score.regressed, 1);
  assert.equal(score.pairedActionable, 2);
  assert.equal(score.pairedBaselineErrorRate, 0.5);
  assert.equal(score.pairedGuardedErrorRate, 0.5);
});
test("unknown adjudication never contributes to paired error rates", () => {
  const score = scoreAssessments([{caseId:"x",baseline:"change",guarded:"abstain",adjudicated:"unknown"}]);
  assert.equal(score.errorsAvoidedByAbstention, 0);
  assert.equal(score.correctDecisionsLostToAbstention, 0);
  assert.equal(score.pairedBaselineErrorRate, null);
});

test("unknown adjudications produce conservative error bounds and block sufficiency", () => {
  const rows = Array.from({length: 30}, (_, i) => ({
    caseId: "case-" + i,
    baseline: "change",
    guarded: "no_change",
    adjudicated: i === 29 ? "unknown" : "no_change"
  }));
  const score = scoreAssessments(rows);
  assert.equal(score.unknownAdjudications, 1);
  assert.equal(score.adjudicationCoverage, 29 / 30);
  assert.deepEqual(score.baselineErrorCountBounds, [29, 30]);
  assert.deepEqual(score.guardedErrorCountBounds, [0, 1]);
  // The unknown case has opposite decisions: its truth can add -1 or +1.\n  assert.deepEqual(score.errorDifferenceBounds, [-30, -28]);
  assert.equal(score.evidenceSufficient, false);
});
test("30 known adjudications have point-identified error counts", () => {
  const rows = Array.from({length: 30}, (_, i) => ({
    caseId: "known-" + i, baseline: "change", guarded: "no_change", adjudicated: "no_change"
  }));
  const score = scoreAssessments(rows);
  assert.equal(score.unknownAdjudications, 0);
  assert.deepEqual(score.baselineErrorCountBounds, [30, 30]);
  assert.deepEqual(score.guardedErrorCountBounds, [0, 0]);
  assert.deepEqual(score.errorDifferenceBounds, [-30, -30]);
  assert.equal(score.evidenceSufficient, true);
});

test("joint error bounds do not invent disagreement when both arms agree", () => {
  const score = scoreAssessments([
    {caseId:"same",baseline:"change",guarded:"change",adjudicated:"unknown"},
    {caseId:"both-abstain",baseline:"abstain",guarded:"abstain",adjudicated:"unknown"}
  ]);
  assert.deepEqual(score.baselineErrorCountBounds, [0, 1]);
  assert.deepEqual(score.guardedErrorCountBounds, [0, 1]);
  assert.deepEqual(score.errorDifferenceBounds, [0, 0]);
});

test("joint bounds account for unknown cases with only one actionable arm", () => {
  const score = scoreAssessments([
    {caseId:"guard-only",baseline:"abstain",guarded:"change",adjudicated:"unknown"},
    {caseId:"base-only",baseline:"no_change",guarded:"abstain",adjudicated:"unknown"}
  ]);
  assert.deepEqual(score.errorDifferenceBounds, [-1, 1]);
});

test("rejects extra fields that may contain merchant data", () => {
  const row = {caseId:"opaque_1",baseline:"change",guarded:"change",adjudicated:"change"};
  assert.throws(() => scoreAssessments([{...row, shopDomain:"example.myshopify.com"}]), /Invalid/);
  assert.throws(() => scoreAssessments([{...row, caseId:"merchant@example.com"}]), /Invalid/);
  assert.throws(() => scoreAssessments([{...row, caseId:"space separated"}]), /Invalid/);
});

test("bounds offline evaluation to 500 cases", () => {
  const rows = Array.from({length:501}, (_,i) => ({caseId:"opaque_"+i,baseline:"change",guarded:"change",adjudicated:"unknown"}));
  assert.throws(() => scoreAssessments(rows), /500/);
  assert.equal(scoreAssessments(rows.slice(0,500)).total,500);
});
