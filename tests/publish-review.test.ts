import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { recordEditorialReview } from "./helpers/editorial-review";
import { publishFromCurrentForm } from "./helpers/publish";
import { publishApprovedArticle } from "../app/lib/publish.server";
import { publishFormDigest } from "../app/lib/editorial-review-integrity";

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
        article:{id:"gid://shopify/Article/123",title:"Useful buying guide",isPublished:true,blog:{id:"gid://shopify/Blog/1"}},
        userErrors:[]
      }}})};
    }
  };
}

test("unreviewed high-score draft cannot reach Shopify and remains ready",async()=>{
  await withDraft(async(shop,draftId)=>{
    const admin=fakeAdmin();
    const result=await publishFromCurrentForm(shop,draftId,admin);
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
      assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
      assert.equal((await publishFromCurrentForm(other,draftId,admin)).ok,false);
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
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
    assert.equal(admin.calls,0);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"rejected");
  });
});

test("usable review permits exactly one explicit publish attempt",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",5)).ok,true);
    const admin=fakeAdmin();
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,true);
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
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
    const result=await publishFromCurrentForm(shop,draftId,admin);
    assert.equal(result.ok,false);
    assert.match(result.message,/could not be confirmed/i);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"needs_reconciliation");
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
    assert.equal(calls,1);
  });
});

test("redacted merchant cannot publish even with an earlier usable review",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",5)).ok,true);
    await db.storeConfig.delete({where:{shop}});
    const admin=fakeAdmin();
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
    assert.equal(admin.calls,0);
  });
});

test("missing destination blog leaves reviewed draft ready and sends no Shopify request",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",2)).ok,true);
    await db.storeConfig.update({where:{shop},data:{blogId:""}});
    const admin=fakeAdmin();
    const result=await publishFromCurrentForm(shop,draftId,admin);
    assert.equal(result.ok,false);
    assert.match(result.message,/destination blog/i);
    assert.equal(admin.calls,0);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"ready");
  });
});

test("Shopify response with unpublished article cannot be counted as published",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",2)).ok,true);
    let calls=0;
    const admin={graphql:async()=>{calls++;return {json:async()=>({data:{articleCreate:{
      article:{id:"gid://shopify/Article/456",title:"Useful buying guide",isPublished:false,blog:{id:"gid://shopify/Blog/1"}},
      userErrors:[]
    }}})};}};
    const result=await publishFromCurrentForm(shop,draftId,admin);
    assert.equal(result.ok,false);
    assert.match(result.message,/could not be confirmed/i);
    const saved=await db.articleDraft.findUniqueOrThrow({where:{id:draftId}});
    assert.equal(saved.status,"needs_reconciliation");
    assert.equal(saved.shopifyArticleId,null);
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
    assert.equal(calls,1);
  });
});

test("Shopify response from another blog cannot be counted as published",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",2)).ok,true);
    let calls=0;
    const admin={graphql:async()=>{calls++;return {json:async()=>({data:{articleCreate:{
      article:{id:"gid://shopify/Article/789",title:"Useful buying guide",isPublished:true,blog:{id:"gid://shopify/Blog/other"}},
      userErrors:[]
    }}})};}};
    const result=await publishFromCurrentForm(shop,draftId,admin);
    assert.equal(result.ok,false);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"needs_reconciliation");
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
    assert.equal(calls,1);
  });
});

test("missing Shopify visibility evidence cannot be mistaken for a successful publish",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",2)).ok,true);
    const admin={graphql:async()=>({json:async()=>({data:{articleCreate:{
      article:{id:"gid://shopify/Article/789",title:"Useful buying guide"},userErrors:[]
    }}})})};
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"needs_reconciliation");
  });
});

test("publish request uses the destination captured at claim time",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",2)).ok,true);
    let calls=0;
    const admin={graphql:async(_query:string,options:any)=>{
      calls++;
      assert.equal(options.variables.article.blogId,"gid://shopify/Blog/1");
      await db.storeConfig.update({where:{shop},data:{blogId:"gid://shopify/Blog/changed"}});
      return {json:async()=>({data:{articleCreate:{
        article:{id:"gid://shopify/Article/123",title:"Useful buying guide",isPublished:true,blog:{id:"gid://shopify/Blog/1"}},
        userErrors:[]
      }}})};
    }};
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,true);
    assert.equal(calls,1);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"published");
  });
});

test("plain-text excerpt is encoded before Shopify receives its HTML summary", async()=>{
  await withDraft(async(shop,draftId)=>{
    await db.articleDraft.update({where:{id:draftId},data:{
      summary:'A & B <img src=x onerror="alert(1)">'
    }});
    assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,true);
    let calls=0;
    const admin={graphql:async(_query:string,options:any)=>{
      calls++;
      assert.equal(options.variables.article.summary,
        "A &amp; B &lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      return {json:async()=>({data:{articleCreate:{
        article:{id:"gid://shopify/Article/123",title:"Useful buying guide",
          isPublished:true,blog:{id:"gid://shopify/Blog/1"}},
        userErrors:[]
      }}})};
    }};
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,true);
    assert.equal(calls,1);
  });
});

test("editing reviewed article fields invalidates approval until explicit re-review", async () => {
  for (const [field, value] of [
    ["title", "Different title after review"],
    ["body", "<p>New claim after review.</p>"],
    ["summary", "Different excerpt after review"],
    ["tags", "new,claims"]
  ] as const) {
    await withDraft(async (shop, draftId) => {
      assert.equal((await recordEditorialReview(shop, draftId, "usable", 3)).ok, true);
      await db.articleDraft.update({where:{id:draftId},data:{[field]:value}});
      const admin=fakeAdmin();
      const blocked=await publishFromCurrentForm(shop,draftId,admin);
      assert.equal(blocked.ok,false,field);
      assert.match(blocked.message,/current usable editorial review/i);
      assert.equal(admin.calls,0,field);
      assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"ready");
      const renewed=await recordEditorialReview(shop,draftId,"usable",4);
      assert.equal(renewed.ok,true,field);
      assert.match(renewed.message,/renewed/i);
      assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,true,field);
      assert.equal(admin.calls,1,field);
      assert.equal(await db.editorialReview.count({where:{shop,draftId}}),1);
    });
  }
});

test("changing the destination blog or article author requires renewed approval", async () => {
  for (const [field,value] of [
    ["blogId","gid://shopify/Blog/changed"],
    ["authorName","Changed Author"]
  ] as const) {
    await withDraft(async(shop,draftId)=>{
      assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,true);
      await db.storeConfig.update({where:{shop},data:{[field]:value}});
      let calls=0;
      const admin={graphql:async()=>{calls++;throw new Error("should not publish");}};
      assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
      assert.equal(calls,0);
      assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,true);
      const review=await db.editorialReview.findUniqueOrThrow({where:{shop_draftId:{shop,draftId}}});
      assert.match(review.contentDigest,/^[0-9a-f]{64}$/);
    });
  }
});

test("legacy usable reviews without a payload digest fail closed and can be renewed", async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,true);
    await db.editorialReview.update({
      where:{shop_draftId:{shop,draftId}},data:{contentDigest:""}
    });
    const admin=fakeAdmin();
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,false);
    assert.equal(admin.calls,0);
    assert.equal((await recordEditorialReview(shop,draftId,"usable",4)).ok,true);
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,true);
    assert.equal(admin.calls,1);
  });
});

test("missing or malformed browser publication version blocks Shopify without claiming the draft",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",2)).ok,true);
    const admin=fakeAdmin();
    for(const version of ["","not-a-version","f".repeat(63)]) {
      const result=await publishApprovedArticle(shop,draftId,admin,version);
      assert.equal(result.ok,false);
      assert.match(result.message,/missing or outdated/i);
    }
    assert.equal(admin.calls,0);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"ready");
  });
});

test("stale publish page cannot publish newly edited and re-approved article",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,true);
    const [before,destination]=await Promise.all([
      db.articleDraft.findUniqueOrThrow({where:{id:draftId}}),
      db.storeConfig.findUniqueOrThrow({where:{shop}})
    ]);
    const openedPage=publishFormDigest(before,destination);
    await db.articleDraft.update({where:{id:draftId},data:{
      body:"<p>Corrected claim reviewed by another editor.</p>"
    }});
    assert.equal((await recordEditorialReview(shop,draftId,"usable",4)).ok,true);
    const admin=fakeAdmin();
    const stale=await publishApprovedArticle(shop,draftId,admin,openedPage);
    assert.equal(stale.ok,false);
    assert.match(stale.message,/changed since this page loaded/i);
    assert.equal(admin.calls,0);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"ready");
    assert.equal((await publishFromCurrentForm(shop,draftId,admin)).ok,true);
    assert.equal(admin.calls,1);
  });
});

test("stale publish page cannot reuse approval after blog or author change",async()=>{
  for(const [field,value] of [
    ["blogId","gid://shopify/Blog/new"],
    ["authorName","Another Author"]
  ] as const) {
    await withDraft(async(shop,draftId)=>{
      assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,true);
      const [before,destination]=await Promise.all([
        db.articleDraft.findUniqueOrThrow({where:{id:draftId}}),
        db.storeConfig.findUniqueOrThrow({where:{shop}})
      ]);
      const openedPage=publishFormDigest(before,destination);
      await db.storeConfig.update({where:{shop},data:{[field]:value}});
      assert.equal((await recordEditorialReview(shop,draftId,"usable",4)).ok,true);
      let calls=0;
      const admin={graphql:async()=>{calls++;throw new Error("Unexpected Shopify call");}};
      const result=await publishApprovedArticle(shop,draftId,admin,openedPage);
      assert.equal(result.ok,false,field);
      assert.match(result.message,/changed since this page loaded/i);
      assert.equal(calls,0);
      assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"ready");
    });
  }
});

test("previously stored oversized reviewed draft cannot trigger Shopify articleCreate", async () => {
  await withDraft(async (shop, draftId) => {
    const body = "<p>" + "é".repeat(31_000) + "</p>";
    await db.articleDraft.update({where:{id:draftId},data:{body,seoScore:90,status:"ready"}});
    assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,true);
    const admin = fakeAdmin();
    const blocked = await publishFromCurrentForm(shop,draftId,admin);
    assert.equal(blocked.ok,false);
    assert.match(blocked.message,/60 KB UTF-8 safety budget/);
    assert.equal(admin.calls,0);
    assert.equal((await db.articleDraft.findUniqueOrThrow({where:{id:draftId}})).status,"ready");
  });
});

test("legacy unsafe HTML cannot reach Shopify even after a usable review", async () => {
  const bodies = [
    '<p><a href="http://unsafe.example/path">Unsafe destination</a></p>',
    '<p><a href="/&#10;/attacker.example/collect">Disguised destination</a></p>',
    '<script>alert(1)</script><p>Unreviewed script markup</p>',
    '<p><a href="https://example.org" rel="opener">Unsupported rel</a></p>',
  ];
  for (const body of bodies) {
    await withDraft(async (shop, draftId) => {
      // Simulate a historical/imported row that bypassed today's sanitizer.
      await db.articleDraft.update({
        where: {id: draftId}, data: {body, seoScore: 90, status: "ready"}
      });
      assert.equal((await recordEditorialReview(shop, draftId, "usable", 3)).ok, true);
      const admin = fakeAdmin();
      const blocked = await publishFromCurrentForm(shop, draftId, admin);
      assert.equal(blocked.ok, false);
      assert.match(blocked.message, /outside the current safety policy/i);
      assert.equal(admin.calls, 0, "no irreversible Shopify mutation");
      assert.equal(
        (await db.articleDraft.findUniqueOrThrow({where: {id: draftId}})).status,
        "ready", "draft remains available for correction and renewed review"
      );
    });
  }
});

test("already sanitized reviewed HTML still reaches the explicit Shopify publish gate", async () => {
  await withDraft(async (shop, draftId) => {
    const body = '<p><a href="/products/boots" rel="sponsored">Product</a></p>';
    await db.articleDraft.update({
      where: {id: draftId}, data: {body, seoScore: 90, status: "ready"}
    });
    assert.equal((await recordEditorialReview(shop, draftId, "usable", 3)).ok, true);
    const admin = fakeAdmin();
    assert.equal((await publishFromCurrentForm(shop, draftId, admin)).ok, true);
    assert.equal(admin.calls, 1);
  });
});
