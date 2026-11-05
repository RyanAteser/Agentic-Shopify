import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEditorialCohort, summarizeEditorialReviews } from "../app/lib/editorial-funnel";

test("empty editorial cohort abstains instead of reporting a success rate", () => {
  const result = summarizeEditorialCohort([], []);
  assert.equal(result.requests, 0);
  assert.equal(result.drafts, 0);
  assert.equal(result.publishedAmongResolvedPct, null);
});

test("counts independent request and draft cohorts without a false delivery ratio", () => {
  const result = summarizeEditorialCohort([
    {status:"completed",count:11}, {status:"failed",count:2},
    {status:"dispatch_uncertain",count:1}
  ],[
    {status:"published",count:6}, {status:"rejected",count:4},
    {status:"ready",count:2}, {status:"needs_review",count:1},
    {status:"needs_reconciliation",count:1}, {status:"publishing",count:1}
  ]);
  assert.equal(result.requests, 14);
  assert.equal(result.failedJobs, 2);
  assert.equal(result.uncertainJobs, 1);
  assert.equal(result.drafts, 15);
  assert.equal(result.resolved, 10);
  assert.equal(result.published, 6);
  assert.equal(result.rejected, 4);
  assert.equal(result.awaitingReview, 3);
  assert.equal(result.reconciliation, 2);
  assert.equal(result.publishedAmongResolvedPct, 60);
});

test("small editorial samples and only pending drafts do not imply acceptance", () => {
  const result = summarizeEditorialCohort([{status:"queued",count:3}],[
    {status:"published",count:3},{status:"rejected",count:1},{status:"ready",count:8}
  ]);
  assert.equal(result.resolved, 4);
  assert.equal(result.publishedAmongResolvedPct, null);
  assert.equal(result.awaitingReview, 8);
});

test("repeated status groups sum and invalid counts fail closed", () => {
  assert.equal(summarizeEditorialCohort(
    [{status:"failed",count:1},{status:"failed",count:2}], []
  ).failedJobs,3);
  assert.throws(() => summarizeEditorialCohort([{status:"failed",count:-1}], []));
  assert.throws(() => summarizeEditorialCohort([], [{status:"published",count:0.5}]));
});

test("resolved-only publication rate does not hide unresolved editorial backlog",()=>{
  const result=summarizeEditorialCohort([],[
    {status:"published",count:5},{status:"rejected",count:5},
    {status:"ready",count:90}
  ]);
  assert.equal(result.publishedAmongResolvedPct,50);
  assert.equal(result.resolvedCoveragePct,10);
  assert.equal(result.publishedAmongAllDraftsPct,5);
  assert.equal(result.awaitingReview,90);
});
test("pending-only and tiny cohorts never imply a mature publication rate",()=>{
  const pending=summarizeEditorialCohort([],[{status:"needs_review",count:10}]);
  assert.equal(pending.resolvedCoveragePct,0);
  assert.equal(pending.publishedAmongAllDraftsPct,0);
  assert.equal(pending.publishedAmongResolvedPct,null);
  const small=summarizeEditorialCohort([],[{status:"published",count:2}]);
  assert.equal(small.resolvedCoveragePct,null);
  assert.equal(small.publishedAmongAllDraftsPct,null);
});
test("corrupt aggregate sums above safe integer range are rejected",()=>{
  assert.throws(()=>summarizeEditorialCohort([],[
    {status:"published",count:Number.MAX_SAFE_INTEGER},
    {status:"rejected",count:1}
  ]),/safe integer range/);
  assert.throws(()=>summarizeEditorialCohort([
    {status:"completed",count:Number.MAX_SAFE_INTEGER},
    {status:"failed",count:1}
  ],[]),/safe integer range/);
});

test("voluntary time reports are suppressed when most reviews omit minutes",()=>{
  const r=summarizeEditorialReviews([
    {decision:"usable",count:90,minutesSamples:3,minutesTotal:12},
    {decision:"rejected",count:10,minutesSamples:2,minutesTotal:30}
  ]);
  assert.equal(r.reviewed,100);
  assert.equal(r.minutesSamples,5);
  assert.equal(r.minutesMissing,95);
  assert.equal(r.minutesCoveragePct,5);
  assert.equal(r.meanReportedMinutes,null);
  assert.equal(r.minutesInterpretation,"low-reporting-coverage");
});
test("adequately covered time reports remain descriptive, not savings",()=>{
  const r=summarizeEditorialReviews([
    {decision:"usable",count:8,minutesSamples:7,minutesTotal:70},
    {decision:"rejected",count:2,minutesSamples:1,minutesTotal:20}
  ]);
  assert.equal(r.minutesCoveragePct,80);
  assert.equal(r.meanReportedMinutes,11.25);
  assert.equal(r.minutesInterpretation,"descriptive-self-reported");
});
test("tiny review samples and time samples abstain",()=>{
  const tiny=summarizeEditorialReviews([{decision:"usable",count:4,minutesSamples:4,minutesTotal:40}]);
  assert.equal(tiny.meanReportedMinutes,null);
  assert.equal(tiny.minutesInterpretation,"insufficient-reviews");
  const few=summarizeEditorialReviews([{decision:"usable",count:10,minutesSamples:4,minutesTotal:40}]);
  assert.equal(few.meanReportedMinutes,null);
  assert.equal(few.minutesInterpretation,"insufficient-time-reports");
});
test("duplicate decision groups and overflowing sums fail closed",()=>{
  assert.throws(()=>summarizeEditorialReviews([
    {decision:"usable",count:5,minutesSamples:5,minutesTotal:25},
    {decision:"usable",count:5,minutesSamples:5,minutesTotal:25}
  ]),/Invalid editorial review aggregate/);
  assert.throws(()=>summarizeEditorialReviews([
    {decision:"usable",count:Number.MAX_SAFE_INTEGER,minutesSamples:0,minutesTotal:0},
    {decision:"rejected",count:1,minutesSamples:0,minutesTotal:0}
  ]),/safe integer range/);
  assert.throws(()=>summarizeEditorialReviews([
    {decision:"usable",count:5,minutesSamples:5,minutesTotal:Number.MAX_SAFE_INTEGER},
    {decision:"rejected",count:1,minutesSamples:1,minutesTotal:1}
  ]),/safe integer range/);
});
