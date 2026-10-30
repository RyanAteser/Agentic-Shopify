import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import {
  loadDraftReviewCoverage, summarizeDraftReviewCoverage, summarizeUnreviewedAge,
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
  });
  assert.deepEqual(summarizeUnreviewedAge(drafts,drafts.map(d=>({draftId:d.id,decision:"usable"})),now),{
    aged7Days:0,aged14Days:0,oldestUnreviewedDays:null,
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
