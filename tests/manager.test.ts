import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { buildBlogTasks, buildRankTasks, buildSeoTasks } from "../app/lib/manager";
import { readMerchantProductSample, syncManagerTasks, logStoreAction } from "../app/lib/manager.server";
import { eraseMerchantData } from "../app/lib/merchant-redaction.server";
import { publishApprovedArticle } from "../app/lib/publish.server";
import { recordEditorialReview } from "../app/lib/editorial-review.server";

test("manager audits only published Online Store products, not other-channel inventory",async()=>{
  const admin={graphql:async(query:string)=>{
    assert.match(query,/status:active published_status:published/);
    return {json:async()=>({data:{products:{nodes:[
      {id:"public",title:"Public boots",description:"",onlineStoreUrl:"https://shop.example/products/boots",seo:null},
      {id:"pos",title:"POS-only boots",description:"",onlineStoreUrl:null,seo:null},
      {id:"bad",title:"Bad URL",description:"",onlineStoreUrl:"javascript:alert(1)",seo:null}
    ]}}})};
  }};
  const sample=await readMerchantProductSample(admin);
  assert.equal(sample.warning,"");
  assert.deepEqual(sample.products.map(p=>p.id),["public"]);
});

test("manager ranks factual SEO findings, editorial drafts and comparable rank drops",()=>{
 const seo=buildSeoTasks([{
   id:"gid://shopify/Product/1:missing-description",productId:"gid://shopify/Product/1",
   productTitle:"Boots",url:"https://store.example/boots",
   kind:"missing-description",message:"No meta description",severity:"high"
 }]);
 assert.equal(seo[0].priority,85);
 const drafts=buildBlogTasks([
   {id:"a",title:"Ready",topic:"boots",seoScore:85,status:"ready",reviewNotes:""},
   {id:"b",title:"Needs work",topic:"boots",seoScore:50,status:"needs_review",reviewNotes:"thin"},
   {id:"c",title:"Published",topic:"boots",seoScore:85,status:"published",reviewNotes:""},
 ]);
 assert.equal(drafts.length,2);
 assert.equal(drafts[0].kind,"blog_publish");
 assert.equal(drafts[1].kind,"blog_review");
 const ranked=buildRankTasks([
   {keyword:"boots",position:11,observedAt:new Date("2026-10-24"),country:"US",device:"desktop",engine:"google",targetUrl:"https://store.example/boots"},
   {keyword:"boots",position:4,observedAt:new Date("2026-10-20"),country:"US",device:"desktop",engine:"google",targetUrl:"https://store.example/boots"},
   {keyword:"boots",position:1,observedAt:new Date("2026-10-24"),country:"CA",device:"desktop",engine:"google",targetUrl:"https://store.example/boots"},
 ]);
 assert.equal(ranked.length,1);
 assert.equal(buildRankTasks([
   {keyword:"old keyword",position:12,observedAt:new Date("2026-07-01"),country:"US",device:"desktop",engine:"google",targetUrl:"https://store.example/a"},
   {keyword:"old keyword",position:2,observedAt:new Date("2026-06-30"),country:"US",device:"desktop",engine:"google",targetUrl:"https://store.example/a"},
 ],new Date("2026-10-24")).length,0);
 assert.match(ranked[0].rationale,/from 4 to 11/);
 assert.equal(buildRankTasks([{keyword:"test",position:null,observedAt:new Date(),country:"US",device:"mobile",engine:"google",targetUrl:""}]).length,0);
});

test("rank changes never compare different pages or unknown result URLs",()=>{
 const base={keyword:"boots",country:"US",device:"desktop",engine:"google"};
 const now=new Date("2026-10-26T12:00:00Z");
 const latest={...base,position:15,observedAt:new Date("2026-10-25T12:00:00Z"),targetUrl:"https://shop.example/products/boots"};
 const previous={...base,position:3,observedAt:new Date("2026-10-24T12:00:00Z"),targetUrl:"https://shop.example/collections/boots"};
 assert.equal(buildRankTasks([latest,previous],now).length,0,
   "a different ranking landing page must not trigger a page-level drop");
 assert.equal(buildRankTasks([{...latest,targetUrl:""},previous],now).length,0,
   "missing target URL cannot establish a comparable page");
 assert.equal(buildRankTasks([latest,{...previous,targetUrl:"https://shop.example/products/boots#details"}],now).length,1,
   "fragments do not change the underlying page");
 assert.equal(buildRankTasks([latest,{...previous,targetUrl:"https://shop.example/products/boots?variant=2"}],now).length,0,
   "a different query string may identify a different page");
 const middle={...base,position:5,observedAt:new Date("2026-10-24T18:00:00Z"),targetUrl:"https://shop.example/collections/boots"};
 const older={...base,position:3,observedAt:new Date("2026-10-23T12:00:00Z"),targetUrl:"https://shop.example/products/boots"};
 assert.equal(buildRankTasks([latest,middle,older],now).length,0,
   "do not skip an intervening page change to cherry-pick a matching older snapshot");
});

test("merchant tasks deduplicate, preserve dismissals and never bleed into another shop",async()=>{
 const shopA="manager-"+randomUUID()+".myshopify.com";
 const shopB="manager-"+randomUUID()+".myshopify.com";
 await db.storeConfig.createMany({data:[{shop:shopA,blogId:"gid://shopify/Blog/1"},{shop:shopB,blogId:"gid://shopify/Blog/2"}]});
 try{
   const job=await db.contentJob.create({data:{shop:shopA,topic:"boot buying guide"}});
   await db.articleDraft.create({data:{
     shop:shopA,jobId:job.id,topic:"boot buying guide",title:"How to choose boots",
     body:"<p>Body</p>",summary:"This is a merchant draft",seoScore:82,status:"ready"
   }});
   const catalog=[{id:"gid://shopify/Product/1",title:"Leather boots",description:"",url:"https://store.example/p/boots",
     seo:{title:"Leather boots",description:null}}];
   await syncManagerTasks(shopA,catalog);
   const first=await db.storeRecommendation.findMany({where:{shop:shopA}});
   assert.equal(first.length,2);
   const seo=first.find(x=>x.agent==="seo");
   assert.ok(seo);
   await db.storeRecommendation.update({where:{id:seo!.id},data:{status:"dismissed"}});
   await syncManagerTasks(shopA,catalog);
   const second=await db.storeRecommendation.findMany({where:{shop:shopA}});
   assert.equal(second.length,2);
   assert.equal(second.find(x=>x.id===seo!.id)?.status,"dismissed");
   assert.equal(await db.storeRecommendation.count({where:{shop:shopB}}),0);
 }finally{
   for(const shop of [shopA,shopB]){
     await db.storeActivity.deleteMany({where:{shop}});
     await db.storeRecommendation.deleteMany({where:{shop}});
     await db.articleDraft.deleteMany({where:{shop}});
     await db.contentJob.deleteMany({where:{shop}});
     await db.storeConfig.deleteMany({where:{shop}});
   }
 }
});

test("manager retires only sampled stale SEO alerts, reopens recurrence, and preserves merchant decisions",async()=>{
 const shop="seo-lifecycle-"+randomUUID()+".myshopify.com";
 const first={id:"gid://shopify/Product/seo1",title:"Leather boots",description:"",
   url:"https://store.example/p/boots",seo:{title:null,description:null}};
 const other={...first,id:"gid://shopify/Product/seo2",title:"Wool socks",
   url:"https://store.example/p/socks"};
 await db.storeConfig.create({data:{shop}});
 try{
   await syncManagerTasks(shop,[first,other]);
   const initial=await db.storeRecommendation.findMany({where:{shop,kind:"seo_review"}});
   assert.equal(initial.length,2);
   const firstTask=initial.find(t=>t.targetId===first.id)!;
   const otherTask=initial.find(t=>t.targetId===other.id)!;
   await syncManagerTasks(shop,[{...first,description:"Detailed fit and material information."}]);
   assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:firstTask.id}})).status,"superseded");
   assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:otherTask.id}})).status,"pending",
     "a product omitted from the current sample is not proven fixed");
   await syncManagerTasks(shop,[]);
   assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:otherTask.id}})).status,"pending",
     "an empty or failed catalog read cannot retire historical evidence");
   await syncManagerTasks(shop,[first]);
   assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:firstTask.id}})).status,"pending",
     "a recurring issue reopens only a machine-superseded task");
   await db.storeRecommendation.update({where:{id:firstTask.id},data:{status:"dismissed"}});
   await syncManagerTasks(shop,[{...first,description:"Now has a useful product description"}]);
   assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:firstTask.id}})).status,"dismissed",
     "never overwrite a merchant dismissal");
 }finally{
   await db.storeActivity.deleteMany({where:{shop}});
   await db.storeRecommendation.deleteMany({where:{shop}});
   await db.storeConfig.deleteMany({where:{shop}});
 }
});

test("merchant-approved publisher creates exactly one Shopify article and blocks stale retries",async()=>{
 const shop="manager-"+randomUUID()+".myshopify.com";
 await db.storeConfig.create({data:{shop,blogId:"gid://shopify/Blog/1"}});
 try{
   const job=await db.contentJob.create({data:{shop,topic:"product care"}});
   const draft=await db.articleDraft.create({data:{
     shop,jobId:job.id,topic:"product care",title:"Product care guide",summary:"Summary",
     body:"<p>Edited and reviewed body</p>",seoScore:90,status:"ready"
   }});
   let called=0;
   const admin={graphql:async (_query:string,_options?:unknown)=>{
     called++;
     return {json:async()=>({data:{articleCreate:{article:{id:"gid://shopify/Article/123",title:"Product care guide",isPublished:true,blog:{id:"gid://shopify/Blog/1"}},userErrors:[]}}})};
   }};
   assert.equal((await recordEditorialReview(shop,draft.id,"usable",5)).ok,true);
   const a=await publishApprovedArticle(shop,draft.id,admin);
   const b=await publishApprovedArticle(shop,draft.id,admin);
   assert.equal(a.ok,true);
   assert.equal(b.ok,false);
   assert.equal(called,1);
   const saved=await db.articleDraft.findUniqueOrThrow({where:{id:draft.id}});
   assert.equal(saved.status,"published");
   assert.equal(saved.shopifyArticleId,"gid://shopify/Article/123");
 }finally{
   await db.editorialReview.deleteMany({where:{shop}});
   await db.articleDraft.deleteMany({where:{shop}});
   await db.contentJob.deleteMany({where:{shop}});
   await db.storeConfig.deleteMany({where:{shop}});
 }
});

test("manager sync and delayed audit writes do not recreate redacted merchant data",async()=>{
 const shop="manager-deleted-"+randomUUID()+".myshopify.com";
 await db.storeConfig.create({data:{shop}});
 const catalog=[{id:"gid://shopify/Product/123",title:"Boots",description:"",url:"https://store.example/boots",seo:null}];
 try{
   assert.ok((await syncManagerTasks(shop,catalog))>0);
   await logStoreAction(shop,null,"manager.sync","applied","before uninstall");
   await eraseMerchantData(shop);
   assert.equal(await syncManagerTasks(shop,catalog),0);
   await logStoreAction(shop,null,"manager.sync","applied","late callback");
   assert.equal(await db.storeConfig.count({where:{shop}}),0);
   assert.equal(await db.storeRecommendation.count({where:{shop}}),0);
   assert.equal(await db.storeActivity.count({where:{shop}}),0);
 }finally{
   await eraseMerchantData(shop);
 }
});

test("partial product samples cannot falsely retire duplicate-title findings",async()=>{
  const shop="seo-title-evidence-"+randomUUID()+".myshopify.com";
  const a={id:"gid://shopify/Product/title-a",title:"Boots",description:"Useful description",
    url:"https://store.example/products/a",seo:{title:"Same title",description:null}};
  const b={...a,id:"gid://shopify/Product/title-b",url:"https://store.example/products/b"};
  await db.storeConfig.create({data:{shop}});
  try {
    await syncManagerTasks(shop,[a,b]);
    const initial=await db.storeRecommendation.findMany({where:{shop,kind:"seo_review"}});
    assert.equal(initial.length,2,"both members of a duplicate group need review");
    const aTask=initial.find(t=>t.targetId===a.id)!;
    const bTask=initial.find(t=>t.targetId===b.id)!;
    assert.equal(JSON.parse(aTask.evidence).observedTitle,"same title");
    await syncManagerTasks(shop,[a]);
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:aTask.id}})).status,"pending",
      "a missing peer in a 50-item sample is not proof of remediation");
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:bTask.id}})).status,"pending");
    await syncManagerTasks(shop,[{...a,seo:{...a.seo,title:"A distinct title"}}]);
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:aTask.id}})).status,"superseded",
      "a changed effective title retires the specific old duplicate observation");
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:bTask.id}})).status,"pending");
    await syncManagerTasks(shop,[a,b]);
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:aTask.id}})).status,"pending",
      "recurring duplicate reopens only machine-superseded findings");
    await db.storeRecommendation.update({where:{id:aTask.id},data:{status:"dismissed"}});
    await syncManagerTasks(shop,[{...a,seo:{...a.seo,title:"Unique now"}}]);
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:aTask.id}})).status,"dismissed",
      "a merchant dismissal must not be rewritten by automated reconciliation");
  }finally{
    await db.storeActivity.deleteMany({where:{shop}});
    await db.storeRecommendation.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
});

test("manager does not retire eligible content recommendations outside its 30-draft sample",async()=>{
  const shop="manager-content-window-"+randomUUID()+".myshopify.com";
  await db.storeConfig.create({data:{shop}});
  try{
    const oldJob=await db.contentJob.create({data:{shop,topic:"evergreen care"}});
    const oldDraft=await db.articleDraft.create({data:{
      shop,jobId:oldJob.id,topic:"evergreen care",title:"Evergreen care guide",
      summary:"Useful care information",body:"<p>Care instructions</p>",
      seoScore:85,status:"ready",createdAt:new Date("2026-01-01T00:00:00Z")
    }});
    await syncManagerTasks(shop,[]);
    const oldTask=await db.storeRecommendation.findUniqueOrThrow({
      where:{shop_sourceKey:{shop,sourceKey:"blog:"+oldDraft.id}}
    });
    assert.equal(oldTask.status,"pending");

    const newer=Array.from({length:30},(_,i)=>({
      id:randomUUID(),shop,topic:"newer draft "+i
    }));
    await db.contentJob.createMany({data:newer});
    await db.articleDraft.createMany({data:newer.map((job,i)=>({
      shop,jobId:job.id,topic:job.topic,title:"Newer guide "+i,
      summary:"Useful information",body:"<p>Care advice</p>",seoScore:85,
      status:"ready",createdAt:new Date("2026-10-20T00:00:00Z")
    }))});
    await syncManagerTasks(shop,[]);
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({
      where:{id:oldTask.id}
    })).status,"pending",
      "an older eligible draft omitted by take:30 must not be marked resolved");

    await db.articleDraft.update({where:{id:oldDraft.id},data:{status:"published"}});
    await syncManagerTasks(shop,[]);
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({
      where:{id:oldTask.id}
    })).status,"resolved",
      "a verified terminal draft status can retire the recommendation");
  }finally{
    await db.storeActivity.deleteMany({where:{shop}});
    await db.storeRecommendation.deleteMany({where:{shop}});
    await db.articleDraft.deleteMany({where:{shop}});
    await db.contentJob.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
});
