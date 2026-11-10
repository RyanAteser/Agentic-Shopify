import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {loadObservedUsage} from "../app/lib/unit-economics.server";

test("owner economics report reads only exact tenant and calendar month",async()=>{
  const shop="econ-"+randomUUID()+".myshopify.com";
  const foreign="econ-"+randomUUID()+".myshopify.com";
  const date=new Date("2026-11-08T14:00:00.000Z");
  const old=new Date("2026-10-09T14:00:00.000Z");
  try{
    for(const s of [shop,foreign]){
      const job=await db.contentJob.create({data:{shop:s,topic:"Audit",createdAt:date}});
      await db.articleDraft.create({data:{shop:s,jobId:job.id,topic:"Audit",
        title:"Safe draft",summary:"Summary",body:"<p>Body</p>",
        status:"published",createdAt:date,publishedAt:date}});
      await db.editorialReview.create({data:{shop:s,draftId:job.id,decision:"approved",
        reviewedAt:date,reviewMinutes:12}});
      await db.seoRankObservation.create({data:{shop:s,keyword:"repair",position:3,
        observedAt:date,receivedAt:date}});
      const run=await db.swarmExecution.create({data:{shop:s,
        caseId:"case-"+randomUUID(),provider:"gemini-generate-content",
        model:"gemini-2.5-flash-lite",plan:"free",usageMonth:"2026-11",
        maxCalls:3,status:"completed"}});
      await db.swarmInvocation.create({data:{shop:s,executionId:run.id,ordinal:0,
        agentId:"synthetic",phase:"independent_hypothesis",status:"committed",
        inputTokens:s===shop?200:99999,outputTokens:100,createdAt:date}});
      await db.swarmInvocation.create({data:{shop:s,executionId:run.id,ordinal:1,
        agentId:"synthetic",phase:"skeptic_challenge",status:"uncertain",createdAt:date}});
    }
    const report=await loadObservedUsage(shop,"2026-11");
    assert.equal(report.invocations.length,2);
    assert.equal(report.invocations[0].inputTokens,200);
    assert.equal(report.generationJobs,1);
    assert.equal(report.drafts,1);
    assert.equal(report.publishedDrafts,1);
    assert.equal(report.editorialDecisions,1);
    assert.equal(report.reviewMinutesReported,1);
    assert.equal(report.reviewMinutesTotal,12);
    assert.equal(report.rankingSnapshots,1);
    assert.equal((await loadObservedUsage(shop,"2026-10")).invocations.length,0);
    assert.throws(()=>loadObservedUsage("elsewhere.evil.tld","2026-11"),/Invalid/);
    await assert.rejects(loadObservedUsage(shop,"2026-13"),/Expected/);
    await db.contentJob.create({data:{shop,topic:"Old work",createdAt:old}});
    assert.equal((await loadObservedUsage(shop,"2026-11")).generationJobs,1);
  }finally{
    for(const s of [shop,foreign]){
      await db.swarmInvocation.deleteMany({where:{shop:s}});
      await db.swarmExecution.deleteMany({where:{shop:s}});
      await db.seoRankObservation.deleteMany({where:{shop:s}});
      await db.editorialReview.deleteMany({where:{shop:s}});
      await db.articleDraft.deleteMany({where:{shop:s}});
      await db.contentJob.deleteMany({where:{shop:s}});
    }
  }
});
