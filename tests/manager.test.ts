import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { buildBlogTasks, buildRankTasks, buildSeoTasks } from "../app/lib/manager";
import { syncManagerTasks } from "../app/lib/manager.server";
import { publishApprovedArticle } from "../app/lib/publish.server";
import { recordEditorialReview } from "../app/lib/editorial-review.server";

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
   const catalog=[{id:"gid://shopify/Product/1",title:"Leather boots",description:"Boots",url:"https://store.example/p/boots",
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
     return {json:async()=>({data:{articleCreate:{article:{id:"gid://shopify/Article/123",title:"Product care guide"},userErrors:[]}}})};
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
