import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { recordEditorialReview } from "../app/lib/editorial-review.server";
import { publishApprovedArticle } from "../app/lib/publish.server";

async function withDraft(fn: (shop: string, draftId: string) => Promise<void>) {
  const shop = "publish-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({data:{shop,blogId:"gid://shopify/Blog/1"}});
  try {
    const job = await db.contentJob.create({data:{shop,topic:"Useful buying guide",status:"completed"}});
    const draft = await db.articleDraft.create({data:{
      shop,jobId:job.id,topic:job.topic,title:"Useful buying guide",
      summary:"Review product fit carefully",body:"<p>Helpful advice.</p>",
      status:"ready",seoScore:90
    }});
    await fn(shop,draft.id);
  } finally {
    await db.editorialReview.deleteMany({where:{shop}});
    await db.articleDraft.deleteMany({where:{shop}});
    await db.contentJob.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
}

function fakeAdmin() {
  let calls=0;
  return {
    get calls(){return calls;},
    graphql:async (_query:string,options:any)=>{
      calls++;
      assert.equal(options.variables.article.isPublished,true);
      assert.equal(options.variables.article.blogId,"gid://shopify/Blog/1");
      return {json:async()=>({data:{articleCreate:{
        article:{id:"gid://shopify/Article/123",title:"Useful buying guide"},
        userErrors:[]
      }}})};
    }
  };
}

test("unreviewed high-score draft cannot reach Shopify and remains ready",async()=>{
  await withDraft(async(shop,draftId)=>{
    const admin=fakeAdmin();
    const result=await publishApprovedArticle(shop,draftId,admin);
    assert.equal(result.ok,false);
    assert.match(result.message,/usable editorial review/i);
    assert.equal(admin.calls,0);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"ready");
  });
});

test("a review for another merchant or draft cannot authorize publication",async()=>{
  await withDraft(async(shop,draftId)=>{
    const other="review-other-"+randomUUID()+".myshopify.com";
    await db.storeConfig.create({data:{shop:other}});
    try{
      const job=await db.contentJob.create({data:{shop:other,topic:"Other",status:"completed"}});
      const draft=await db.articleDraft.create({data:{
        shop:other,jobId:job.id,topic:"Other",title:"Other draft",
        summary:"Other summary",body:"<p>Other</p>",status:"ready",seoScore:90
      }});
      assert.equal((await recordEditorialReview(other,draft.id,"usable",3)).ok,true);
      const admin=fakeAdmin();
      assert.equal((await publishApprovedArticle(shop,draftId,admin)).ok,false);
      assert.equal((await publishApprovedArticle(other,draftId,admin)).ok,false);
      assert.equal(admin.calls,0);
    }finally{
      await db.editorialReview.deleteMany({where:{shop:other}});
      await db.articleDraft.deleteMany({where:{shop:other}});
      await db.contentJob.deleteMany({where:{shop:other}});
      await db.storeConfig.deleteMany({where:{shop:other}});
    }
  });
});

test("rejected review cannot publish",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"rejected",4,"Unverified claim")).ok,true);
    const admin=fakeAdmin();
    assert.equal((await publishApprovedArticle(shop,draftId,admin)).ok,false);
    assert.equal(admin.calls,0);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"rejected");
  });
});

test("usable review permits exactly one explicit publish attempt",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",5)).ok,true);
    const admin=fakeAdmin();
    assert.equal((await publishApprovedArticle(shop,draftId,admin)).ok,true);
    assert.equal((await publishApprovedArticle(shop,draftId,admin)).ok,false);
    assert.equal(admin.calls,1);
    const saved=await db.articleDraft.findUniqueOrThrow({where:{id:draftId}});
    assert.equal(saved.status,"published");
    assert.equal(saved.shopifyArticleId,"gid://shopify/Article/123");
  });
});

test("uncertain Shopify response requires reconciliation and forbids replay",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",5)).ok,true);
    let calls=0;
    const admin={graphql:async()=>{calls++;throw new Error("simulated lost response");}};
    const result=await publishApprovedArticle(shop,draftId,admin);
    assert.equal(result.ok,false);
    assert.match(result.message,/could not be confirmed/i);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"needs_reconciliation");
    assert.equal((await publishApprovedArticle(shop,draftId,admin)).ok,false);
    assert.equal(calls,1);
  });
});

test("redacted merchant cannot publish even with an earlier usable review",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",5)).ok,true);
    await db.storeConfig.delete({where:{shop}});
    const admin=fakeAdmin();
    assert.equal((await publishApprovedArticle(shop,draftId,admin)).ok,false);
    assert.equal(admin.calls,0);
  });
});
