import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {reviewFormDigest} from "../app/lib/editorial-review-integrity";
import {recordEditorialReview} from "../app/lib/editorial-review.server";

async function withDraft(run:(shop:string,id:string)=>Promise<void>, status="ready") {
  const shop="review-stale-"+randomUUID()+".myshopify.com";
  await db.storeConfig.create({data:{shop,blogId:"gid://shopify/Blog/1",authorName:"Editorial Team"}});
  try {
    const job=await db.contentJob.create({data:{shop,topic:"Product facts",status:"completed"}});
    const draft=await db.articleDraft.create({data:{
      shop,jobId:job.id,topic:job.topic,status,title:"Compare product facts",
      summary:"Check sizing and fit.",body:"<p>Check published specifications.</p>",
      tags:"Guide",keyword:"sizing",seoScore:90
    }});
    await run(shop,draft.id);
  } finally {
    await db.editorialReview.deleteMany({where:{shop}});
    await db.articleDraft.deleteMany({where:{shop}});
    await db.contentJob.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
}
async function version(shop:string,id:string) {
  const [draft,config]=await Promise.all([
    db.articleDraft.findUniqueOrThrow({where:{id}}),
    db.storeConfig.findUniqueOrThrow({where:{shop}})
  ]);
  return reviewFormDigest(draft,config);
}

test("missing review-form fingerprint cannot approve a draft",async()=>{
  await withDraft(async(shop,id)=>{
    const result=await recordEditorialReview(shop,id,"usable",3,"");
    assert.equal(result.ok,false);
    assert.match(result.message,/missing or outdated/i);
    assert.equal(await db.editorialReview.count({where:{shop}}),0);
  });
});

test("stale approval cannot authorize content changed after page render",async()=>{
  await withDraft(async(shop,id)=>{
    const old=await version(shop,id);
    await db.articleDraft.update({where:{id},data:{body:"<p>Changed product claims after review screen loaded.</p>"}});
    const stale=await recordEditorialReview(shop,id,"usable",5,old);
    assert.equal(stale.ok,false);
    assert.match(stale.message,/changed since/i);
    assert.equal(await db.editorialReview.count({where:{shop}}),0);
    assert.equal((await recordEditorialReview(shop,id,"usable",5,await version(shop,id))).ok,true);
  });
});

test("destination and author changes invalidate an open review form",async()=>{
  await withDraft(async(shop,id)=>{
    const old=await version(shop,id);
    await db.storeConfig.update({where:{shop},data:{blogId:"gid://shopify/Blog/2"}});
    assert.equal((await recordEditorialReview(shop,id,"usable",3,old)).ok,false);
    const afterBlog=await version(shop,id);
    await db.storeConfig.update({where:{shop},data:{authorName:"Another Author"}});
    assert.equal((await recordEditorialReview(shop,id,"usable",3,afterBlog)).ok,false);
    assert.equal(await db.editorialReview.count({where:{shop}}),0);
  });
});

test("keyword-only edits also invalidate an old review form",async()=>{
  await withDraft(async(shop,id)=>{
    const old=await version(shop,id);
    await db.articleDraft.update({where:{id},data:{keyword:"different keyword"}});
    assert.equal((await recordEditorialReview(shop,id,"usable",3,old)).ok,false);
    assert.equal(await db.editorialReview.count({where:{shop}}),0);
  });
});

test("stale rejection cannot discard a concurrently corrected draft",async()=>{
  await withDraft(async(shop,id)=>{
    const old=await version(shop,id);
    await db.articleDraft.update({where:{id},data:{body:"<p>Merchant fixed the factual error.</p>"}});
    assert.equal((await recordEditorialReview(shop,id,"rejected",2,old,"Incorrect facts")).ok,false);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id}})).status,"ready");
    assert.equal(await db.editorialReview.count({where:{shop}}),0);
  });
});

test("a fresh form can renew a previously approved but edited draft",async()=>{
  await withDraft(async(shop,id)=>{
    assert.equal((await recordEditorialReview(shop,id,"usable",3,await version(shop,id))).ok,true);
    const old=await version(shop,id);
    await db.articleDraft.update({where:{id},data:{summary:"Corrected product description."}});
    assert.equal((await recordEditorialReview(shop,id,"usable",3,old)).ok,false);
    assert.equal((await recordEditorialReview(shop,id,"usable",4,await version(shop,id))).ok,true);
    assert.equal(await db.editorialReview.count({where:{shop}}),1);
    const review=await db.editorialReview.findUniqueOrThrow({where:{shop_draftId:{shop,draftId:id}}});
    assert.equal(review.reviewMinutes,4);
  });
});
