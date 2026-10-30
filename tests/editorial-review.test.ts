import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {parseReviewMinutes} from "../app/lib/editorial-review.server";
import {recordEditorialReview} from "./helpers/editorial-review";
import {summarizeEditorialReviews} from "../app/lib/editorial-funnel";

test("review aggregation uses explicit decisions and observed minutes",()=>{
  assert.equal(summarizeEditorialReviews([]).usableAmongReviewedPct,null);
  const result=summarizeEditorialReviews([
    {decision:"usable",count:3,minutesSamples:2,minutesTotal:30},
    {decision:"rejected",count:2,minutesSamples:1,minutesTotal:15}
  ]);
  assert.equal(result.reviewed,5);
  assert.equal(result.usableAmongReviewedPct,60);
  // Only 3/5 decisions reported minutes. The mean must be withheld rather
  // than presented as representative of all merchant review decisions.
  assert.equal(result.meanReportedMinutes,null);
  assert.equal(result.minutesInterpretation,"insufficient-time-reports");
  assert.equal(result.minutesCoveragePct,60);
  assert.equal(result.minutesMissing,2);
  assert.equal(result.minutesSamples,3);
  assert.throws(()=>summarizeEditorialReviews([{decision:"published",count:5,minutesSamples:0,minutesTotal:0}]));
  assert.throws(()=>summarizeEditorialReviews([{decision:"usable",count:1,minutesSamples:2,minutesTotal:10}]));
});

test("self-reported minutes must be a bounded positive integer",()=>{
  assert.equal(parseReviewMinutes(null),null);
  assert.equal(parseReviewMinutes(""),null);
  assert.equal(parseReviewMinutes("12"),12);
  for(const bad of ["0","241","1.5","-3","Infinity","1e2","abc"]){
    assert.throws(()=>parseReviewMinutes(bad));
  }
});

test("merchant reviews are shop-scoped, one-time and never publish",async()=>{
  const shop="review-"+randomUUID()+".myshopify.com";
  const other="other-"+randomUUID()+".myshopify.com";
  const where={shop:{in:[shop,other]}};
  await db.storeConfig.createMany({data:[{shop},{shop:other}]});
  try{
    const jobs=await Promise.all([
      db.contentJob.create({data:{shop,topic:"Usable"}}),
      db.contentJob.create({data:{shop,topic:"Rejected"}}),
      db.contentJob.create({data:{shop,topic:"Late"}}),
      db.contentJob.create({data:{shop:other,topic:"Other"}})
    ]);
    const drafts=await Promise.all(jobs.map((job,i)=>db.articleDraft.create({
      data:{shop:i===3?other:shop,jobId:job.id,topic:"Review",
        title:"Draft "+i,summary:"Test",body:"<p>Test</p>",status:i===1?"needs_review":"ready"}
    })));
    assert.equal((await recordEditorialReview(other,drafts[0].id,"usable",5)).ok,false);
    assert.equal(await db.editorialReview.count({where:{shop:other}}),0);
    const accepted=await recordEditorialReview(shop,drafts[0].id,"usable",12);
    assert.equal(accepted.ok,true);
    assert.match(accepted.message,/NOT been published/);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:drafts[0].id}})).status,"ready");
    assert.equal((await recordEditorialReview(shop,drafts[0].id,"usable",12)).ok,false);
    assert.equal((await recordEditorialReview(shop,drafts[1].id,"rejected",8,"")).ok,false);
    assert.equal((await recordEditorialReview(shop,drafts[1].id,"rejected",8,"Incorrect details")).ok,true);
    const rejected=await db.articleDraft.findUniqueOrThrow({where:{id:drafts[1].id}});
    assert.equal(rejected.status,"rejected");
    assert.equal(rejected.reviewNotes,"Incorrect details");
    assert.equal(await db.editorialReview.count({where:{shop}}),2);
    assert.equal((await recordEditorialReview(shop,drafts[1].id,"usable",10)).ok,false);
    await db.storeConfig.delete({where:{shop}});
    assert.equal((await recordEditorialReview(shop,drafts[2].id,"usable",9)).ok,false);
    assert.equal(await db.editorialReview.count({where:{shop}}),2);
  }finally{
    await db.editorialReview.deleteMany({where});
    await db.articleDraft.deleteMany({where});
    await db.contentJob.deleteMany({where});
    await db.storeConfig.deleteMany({where});
  }
});
