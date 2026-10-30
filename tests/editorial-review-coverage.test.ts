import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import {
  loadDraftReviewCoverage, summarizeDraftReviewCoverage, summarizeUnreviewedAge, summarizeRecordedReviewElapsed,
} from "../app/lib/editorial-review-coverage.server";

test("coverage denominator includes unresolved and rejected drafts, not only decisions", () => {
  const drafts = [
    {id:"a",status:"ready"}, {id:"b",status:"published"},
    {id:"c",status:"rejected"}, {id:"d",status:"needs_review"},
    {id:"e",status:"published"},
  ];
  const result = summarizeDraftReviewCoverage(drafts, [
    {draftId:"a",decision:"usable"}, {draftId:"c",decision:"rejected"},
  ]);
  assert.deepEqual(result, {
    drafts:5, reviewed:2, unreviewed:3, usable:1, rejected:1,
    publishedWithoutReview:2, coveragePct:40,
  });
});

test("small and empty cohorts abstain from percentage claims", () => {
  assert.equal(summarizeDraftReviewCoverage([], []).coveragePct, null);
  const result = summarizeDraftReviewCoverage([{id:"a",status:"ready"}], []);
  assert.equal(result.coveragePct, null);
  assert.equal(result.unreviewed, 1);
});

test("duplicate, foreign and invalid review records fail closed", () => {
  const drafts = [{id:"a",status:"ready"}];
  assert.throws(() => summarizeDraftReviewCoverage([drafts[0],drafts[0]], []));
  assert.throws(() => summarizeDraftReviewCoverage(drafts,[{draftId:"b",decision:"usable"}]));
  assert.throws(() => summarizeDraftReviewCoverage(drafts,[
    {draftId:"a",decision:"usable"},{draftId:"a",decision:"usable"},
  ]));
  assert.throws(() => summarizeDraftReviewCoverage(drafts,[{draftId:"a",decision:"published"}]));
});

test("database coverage is tenant-scoped and uses draft creation dates, not review dates", async () => {
  const shopA = "coverage-" + randomUUID() + ".myshopify.com";
  const shopB = "coverage-" + randomUUID() + ".myshopify.com";
  const now = new Date();
  const since = new Date(now.getTime() - 28 * 86400000);
  const older = new Date(now.getTime() - 35 * 86400000);
  const where = {shop:{in:[shopA,shopB]}};
  await db.storeConfig.createMany({data:[{shop:shopA},{shop:shopB}]});
  try {
    const makeDraft = async (shop: string, createdAt: Date, status: string) => {
      const job = await db.contentJob.create({data:{shop,topic:"Coverage fixture"}});
      return db.articleDraft.create({data:{
        shop,jobId:job.id,topic:"Coverage",title:"Fixture",summary:"Fixture",
        body:"<p>Fixture</p>",status,createdAt,
      }});
    };
    const reviewedA = await makeDraft(shopA,now,"published");
    await makeDraft(shopA,now,"ready");
    await makeDraft(shopA,now,"published");
    const olderA = await makeDraft(shopA,older,"rejected");
    const reviewedB = await makeDraft(shopB,now,"published");
    await db.editorialReview.createMany({data:[
      {shop:shopA,draftId:reviewedA.id,decision:"usable"},
      {shop:shopA,draftId:olderA.id,decision:"rejected"},
      {shop:shopB,draftId:reviewedB.id,decision:"usable"},
    ]});
    const result = await loadDraftReviewCoverage(shopA,since,new Date(now.getTime()+60000));
    assert.equal(result.available,true);
    if (!result.available) throw new Error("Unexpected coverage abstention");
    assert.equal(result.drafts,3);
    assert.equal(result.reviewed,1);
    assert.equal(result.unreviewed,2);
    assert.equal(result.publishedWithoutReview,1);
    assert.equal(result.coveragePct,null);
  } finally {
    await db.editorialReview.deleteMany({where});
    await db.articleDraft.deleteMany({where});
    await db.contentJob.deleteMany({where});
    await db.storeConfig.deleteMany({where});
  }
});

test("unreviewed aging counts exact 7/14 day boundaries without labeling reviewed drafts overdue",()=>{
  const now=new Date("2026-10-30T12:00:00Z");
  const days=(n:number)=>new Date(now.getTime()-n*86400000);
  const drafts=[
    {id:"new",status:"ready",createdAt:days(6)},
    {id:"week",status:"ready",createdAt:days(7)},
    {id:"fortnight",status:"needs_review",createdAt:days(14)},
    {id:"reviewed",status:"published",createdAt:days(27)},
  ];
  assert.deepEqual(summarizeUnreviewedAge(drafts,[{draftId:"reviewed",decision:"usable"}],now),{
    aged7Days:2,aged14Days:1,oldestUnreviewedDays:14,
    actionableUnreviewed:3,actionableAged7Days:2,actionableAged14Days:1,oldestActionableDays:14,
  });
  assert.deepEqual(summarizeUnreviewedAge(drafts,drafts.map(d=>({draftId:d.id,decision:"usable"})),now),{
    aged7Days:0,aged14Days:0,oldestUnreviewedDays:null,
    actionableUnreviewed:0,actionableAged7Days:0,actionableAged14Days:0,oldestActionableDays:null,
  });
});
test("unreviewed aging fails closed on future dates, duplicates and foreign review IDs",()=>{
  const now=new Date("2026-10-30T12:00:00Z");
  const row={id:"a",status:"ready",createdAt:now};
  assert.throws(()=>summarizeUnreviewedAge([row,{...row}],[],now),/Duplicate/);
  assert.throws(()=>summarizeUnreviewedAge([{...row,createdAt:new Date(now.getTime()+1)}],[],now),/creation date/);
  assert.throws(()=>summarizeUnreviewedAge([row],[{draftId:"other",decision:"usable"}],now),/Foreign/);
  assert.throws(()=>summarizeUnreviewedAge([row],[],new Date(NaN)),/reporting instant/);
});

test("published and rejected drafts missing reviews are not actionable editorial backlog",()=>{
  const now=new Date("2026-10-30T12:00:00Z");
  const days=(n:number)=>new Date(now.getTime()-n*86400000);
  const drafts=[
    {id:"published",status:"published",createdAt:days(25)},
    {id:"rejected",status:"rejected",createdAt:days(20)},
    {id:"reconcile",status:"needs_reconciliation",createdAt:days(18)},
    {id:"ready",status:"ready",createdAt:days(8)},
    {id:"needs",status:"needs_review",createdAt:days(3)},
  ];
  const result=summarizeUnreviewedAge(drafts,[],now);
  assert.equal(result.aged14Days,3);
  assert.equal(result.oldestUnreviewedDays,25);
  assert.equal(result.actionableUnreviewed,2);
  assert.equal(result.actionableAged7Days,1);
  assert.equal(result.actionableAged14Days,0);
  assert.equal(result.oldestActionableDays,8);
});

test("no actionable queue is not confused with missing historical review records",()=>{
  const now=new Date("2026-10-30T12:00:00Z");
  const result=summarizeUnreviewedAge([{id:"published",status:"published",createdAt:new Date("2026-10-01T12:00:00Z")}],[],now);
  assert.equal(result.oldestActionableDays,null);
  assert.equal(result.actionableUnreviewed,0);
  assert.equal(result.aged14Days,1);
});

test("latest recorded review elapsed reports median and nearest-rank p90 without calling it first response",()=>{
  const now=new Date("2026-10-30T12:00:00Z");
  const drafts=Array.from({length:5},(_,i)=>({
    id:"draft"+i,status:"ready",createdAt:new Date(now.getTime()-10*3600000)
  }));
  const reviews=drafts.map((d,i)=>({
    draftId:d.id,decision:"usable",reviewedAt:new Date(d.createdAt.getTime()+(i+1)*3600000)
  }));
  const result=summarizeRecordedReviewElapsed(drafts,reviews,now);
  assert.equal(result.reviewElapsedSamples,5);
  assert.equal(result.medianRecordedReviewHours,3);
  assert.equal(result.p90RecordedReviewHours,5);
  assert.equal(result.reviewElapsedInvalid,0);
});
test("unreviewed drafts never count as instant decisions and small cohorts abstain",()=>{
  const now=new Date("2026-10-30T12:00:00Z");
  const drafts=Array.from({length:6},(_,i)=>({id:"draft"+i,status:"ready",
    createdAt:new Date(now.getTime()-36000000)}));
  const reviews=drafts.slice(0,4).map(d=>({draftId:d.id,decision:"usable",
    reviewedAt:new Date(now.getTime()-3600000)}));
  const result=summarizeRecordedReviewElapsed(drafts,reviews,now);
  assert.equal(result.reviewElapsedSamples,4);
  assert.equal(result.medianRecordedReviewHours,null);
  assert.equal(result.p90RecordedReviewHours,null);
});
test("future and pre-creation review dates abstain instead of skewing latency",()=>{
  const now=new Date("2026-10-30T12:00:00Z");
  const drafts=Array.from({length:5},(_,i)=>({id:"draft"+i,status:"ready",
    createdAt:new Date(now.getTime()-36000000)}));
  const reviews=drafts.map(d=>({draftId:d.id,decision:"usable",
    reviewedAt:new Date(now.getTime()-3600000)}));
  reviews[0].reviewedAt=new Date(now.getTime()+1000);
  const result=summarizeRecordedReviewElapsed(drafts,reviews,now);
  assert.equal(result.reviewElapsedInvalid,1);
  assert.equal(result.medianRecordedReviewHours,null);
  reviews[0].reviewedAt=new Date(now.getTime()-72000000);
  assert.equal(summarizeRecordedReviewElapsed(drafts,reviews,now).p90RecordedReviewHours,null);
});
test("duplicate or foreign review records are rejected",()=>{
  const now=new Date("2026-10-30T12:00:00Z");
  const drafts=[{id:"a",status:"ready",createdAt:new Date(now.getTime()-3600000)}];
  const r={draftId:"a",decision:"usable",reviewedAt:now};
  assert.throws(()=>summarizeRecordedReviewElapsed(drafts,[r,r],now),/Invalid editorial cohort review/);
  assert.throws(()=>summarizeRecordedReviewElapsed(drafts,[{...r,draftId:"foreign"}],now),/Invalid editorial cohort review/);
});
