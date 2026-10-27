import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { summarizeEditorialCohort } from "../app/lib/editorial-funnel";

test("editorial cohorts stay shop-scoped and never divide mismatched creation cohorts", async () => {
  const shopA = "editorial-" + randomUUID() + ".myshopify.com";
  const shopB = "editorial-" + randomUUID() + ".myshopify.com";
  const now = new Date();
  const since = new Date(now.getTime() - 28 * 86400000);
  await db.storeConfig.createMany({ data: [{ shop: shopA }, { shop: shopB }] });
  try {
    const recentA = await db.contentJob.create({data:{shop:shopA,topic:"A recent"}});
    const olderA = await db.contentJob.create({data:{
      shop:shopA,topic:"A older",createdAt:new Date(now.getTime()-35*86400000)
    }});
    const recentB = await db.contentJob.create({data:{shop:shopB,topic:"B recent"}});
    await db.articleDraft.createMany({data:[
      {shop:shopA,jobId:recentA.id,topic:"A recent",title:"A",summary:"A",body:"<p>A</p>",status:"published"},
      {shop:shopA,jobId:olderA.id,topic:"A older",title:"A2",summary:"A2",body:"<p>A2</p>",status:"rejected"},
      {shop:shopB,jobId:recentB.id,topic:"B recent",title:"B",summary:"B",body:"<p>B</p>",status:"published"}
    ]});
    const [jobs,drafts]=await Promise.all([
      db.contentJob.groupBy({by:["status"],where:{shop:shopA,createdAt:{gte:since,lt:new Date(Date.now()+60000)}},_count:{_all:true}}),
      db.articleDraft.groupBy({by:["status"],where:{shop:shopA,createdAt:{gte:since,lt:new Date(Date.now()+60000)}},_count:{_all:true}})
    ]);
    const cohort=summarizeEditorialCohort(
      jobs.map(x=>({status:x.status,count:x._count._all})),
      drafts.map(x=>({status:x.status,count:x._count._all}))
    );
    assert.equal(cohort.requests,1,"older A job and B job are excluded");
    assert.equal(cohort.drafts,2,"draft from older job is still in current draft cohort");
    assert.equal(cohort.published,1);
    assert.equal(cohort.rejected,1);
    assert.equal(cohort.publishedAmongResolvedPct,null,"small sample abstains");
  } finally {
    const where={shop:{in:[shopA,shopB]}};
    await db.articleDraft.deleteMany({where});
    await db.contentJob.deleteMany({where});
    await db.storeConfig.deleteMany({where});
  }
});
