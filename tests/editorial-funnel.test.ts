import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEditorialCohort } from "../app/lib/editorial-funnel";

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
