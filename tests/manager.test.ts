import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { buildBlogTasks, buildRankTasks, buildSeoTasks, rankIncidentKey, rankingDropHasRecovered } from "../app/lib/manager";
import { readMerchantProductSample, syncManagerTasks, logStoreAction } from "../app/lib/manager.server";
import { eraseMerchantData } from "../app/lib/merchant-redaction.server";
import { publishFromCurrentForm } from "./helpers/publish";
import { recordEditorialReview } from "./helpers/editorial-review";

test("manager audits only published Online Store products, not other-channel inventory",async()=>{
  const admin={graphql:async(query:string)=>{
    assert.match(query,/status:active published_status:published/);
    return {json:async()=>({data:{products:{nodes:[
      {id:"gid://shopify/Product/101",title:"Public boots",description:"",onlineStoreUrl:"https://shop.example/products/boots",seo:null},
      {id:"gid://shopify/Product/102",title:"POS-only boots",description:"",onlineStoreUrl:null,seo:null},
      {id:"gid://shopify/Product/103",title:"Bad URL",description:"",onlineStoreUrl:"javascript:alert(1)",seo:null}
    ],pageInfo:{hasNextPage:false,endCursor:"cursor-3"}}}})};
  }};
  const sample=await readMerchantProductSample(admin);
  assert.match(sample.warning,/Password-protected Shopify stores/);
  assert.match(sample.warning,/non-HTTPS/);
  assert.deepEqual(sample.products.map(p=>p.id),["gid://shopify/Product/101"]);
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
   {keyword:"boots",position:9,observedAt:new Date("2026-10-22"),country:"US",device:"desktop",engine:"google",targetUrl:"https://store.example/boots"},
   {keyword:"boots",position:4,observedAt:new Date("2026-10-20"),country:"US",device:"desktop",engine:"google",targetUrl:"https://store.example/boots"},
   {keyword:"boots",position:1,observedAt:new Date("2026-10-24"),country:"CA",device:"desktop",engine:"google",targetUrl:"https://store.example/boots"},
 ]);
 assert.equal(ranked.length,1);
 assert.equal(buildRankTasks([
   {keyword:"old keyword",position:12,observedAt:new Date("2026-07-01"),country:"US",device:"desktop",engine:"google",targetUrl:"https://store.example/a"},
   {keyword:"old keyword",position:2,observedAt:new Date("2026-06-30"),country:"US",device:"desktop",engine:"google",targetUrl:"https://store.example/a"},
 ],new Date("2026-10-24")).length,0);
 assert.match(ranked[0].rationale,/4 → 9 → 11/);
 assert.equal(buildRankTasks([{keyword:"test",position:null,observedAt:new Date(),country:"US",device:"mobile",engine:"google",targetUrl:""}]).length,0);
});

test("rank changes never compare different pages or unknown result URLs",()=>{
 const base={keyword:"boots",country:"US",device:"desktop",engine:"google"};
 const now=new Date("2026-10-26T12:00:00Z");
 const latest={...base,position:15,observedAt:new Date("2026-10-25T12:00:00Z"),targetUrl:"https://shop.example/products/boots"};
 const previous={...base,position:7,observedAt:new Date("2026-10-24T12:00:00Z"),targetUrl:"https://shop.example/collections/boots"};
 const baseline={...base,position:3,observedAt:new Date("2026-10-23T12:00:00Z"),targetUrl:"https://shop.example/products/boots"};
 assert.equal(buildRankTasks([latest,previous,baseline],now).length,0,
   "a different ranking landing page must not trigger a page-level drop");
 assert.equal(buildRankTasks([{...latest,targetUrl:""},previous,baseline],now).length,0,
   "missing target URL cannot establish a comparable page");
 assert.equal(buildRankTasks([latest,{...previous,targetUrl:"https://shop.example/products/boots#details"},baseline],now).length,1,
   "fragments do not change the underlying page");
 assert.equal(buildRankTasks([latest,{...previous,targetUrl:"https://shop.example/products/boots?variant=2"},baseline],now).length,0,
   "a different query string may identify a different page");
 const middle={...base,position:5,observedAt:new Date("2026-10-24T18:00:00Z"),targetUrl:"https://shop.example/collections/boots"};
 const older={...base,position:3,observedAt:new Date("2026-10-23T12:00:00Z"),targetUrl:"https://shop.example/products/boots"};
 assert.equal(buildRankTasks([latest,middle,older],now).length,0,
   "do not skip an intervening page change to cherry-pick a matching older snapshot");
});

test("single SERP dip or rebound never becomes a confirmed manager alert",()=>{
  const now=new Date("2026-10-28T12:00:00Z");
  const base={keyword:"boots",country:"US",device:"desktop",engine:"google",
    targetUrl:"https://shop.example/products/boots"};
  const point=(position:number,date:string)=>({...base,position,observedAt:new Date(date)});
  const baseline=point(4,"2026-10-23T12:00:00Z");
  const dip=point(12,"2026-10-24T12:00:00Z");
  const rebound=point(5,"2026-10-25T12:00:00Z");
  assert.equal(buildRankTasks([dip,baseline],now).length,0,
    "two points alone cannot establish a persistent decline");
  assert.equal(buildRankTasks([rebound,dip,baseline],now).length,0,
    "a one-off drop followed by recovery is not sustained");
  assert.equal(buildRankTasks([point(12,"2026-10-26T12:00:00Z"),rebound,dip,baseline],now).length,0,
    "do not cherry-pick an older baseline through an intervening rebound");
  const confirmation=point(9,"2026-10-25T12:00:00Z");
  const latest=point(11,"2026-10-26T12:00:00Z");
  const [alert]=buildRankTasks([latest,confirmation,baseline],now);
  assert.ok(alert);
  const evidence=JSON.parse(alert.evidence);
  assert.equal(evidence.previousRank,4);
  assert.equal(evidence.confirmationRank,9);
  assert.equal(evidence.latestRank,11);
  assert.match(alert.rationale,/Three distinct UTC-day same-page SERP observations/);
  assert.equal(buildRankTasks([latest,{...confirmation,position:6},baseline],now).length,0,
    "both newer observations must be at least three positions below baseline");
  assert.equal(buildRankTasks([latest,confirmation,point(4,"2026-08-01T12:00:00Z")],now).length,0,
    "a baseline older than 28 days cannot support a fresh alert");
  assert.equal(buildRankTasks([latest,confirmation,{...baseline,targetUrl:"https://shop.example/products/other"}],now).length,0,
    "all three observations must concern the same landing page");
});

test("rank alerts require independent days, not three rapid repeated scrapes",()=>{
  const now=new Date("2026-10-28T12:00:00Z");
  const base={keyword:"boots",country:"US",device:"desktop",engine:"google",
    targetUrl:"https://shop.example/products/boots"};
  const row=(position:number,at:string,targetUrl=base.targetUrl)=>({
    ...base,position,observedAt:new Date(at),targetUrl
  });
  const sameDay=[row(4,"2026-10-26T08:00:00Z"),row(9,"2026-10-26T09:00:00Z"),
    row(12,"2026-10-26T10:00:00Z")];
  assert.equal(buildRankTasks(sameDay,now).length,0,
    "three scrapes within two hours are not three days of independent evidence");

  const baseline=row(4,"2026-10-23T12:00:00Z");
  const confirmation=row(9,"2026-10-24T12:00:00Z");
  const latest=row(12,"2026-10-25T12:00:00Z");
  assert.equal(buildRankTasks([baseline,confirmation,latest],now).length,1);

  // Multiple daily samples are fine when every intervening scrape agrees.
  assert.equal(buildRankTasks([baseline,confirmation,
    row(10,"2026-10-24T18:00:00Z"),latest,
    row(13,"2026-10-25T18:00:00Z")],now).length,1);

  // Do not cherry-pick a later decline through an intraday recovery.
  assert.equal(buildRankTasks([baseline,confirmation,latest,
    row(5,"2026-10-25T15:00:00Z"),row(12,"2026-10-25T18:00:00Z")],now).length,0);
  assert.equal(buildRankTasks([baseline,confirmation,latest,
    row(11,"2026-10-24T18:00:00Z","https://shop.example/products/other")],now).length,0);
  assert.equal(buildRankTasks([baseline,confirmation,latest,
    {...row(11,"2026-10-24T18:00:00Z"),position:null,targetUrl:""}],now).length,0);

  const bing=[baseline,confirmation,latest].map(r=>({...r,engine:"bing"}));
  const [bingAlert]=buildRankTasks(bing,now);
  assert.ok(bingAlert);
  assert.match(bingAlert.rationale,/Bing Webmaster Tools/);
  assert.doesNotMatch(bingAlert.rationale,/Check Google Search Console clicks/);
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
   const a=await publishFromCurrentForm(shop,draft.id,admin);
   const b=await publishFromCurrentForm(shop,draft.id,admin);
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


test("ranking recovery requires a newer fresh observation of the same page and market",()=>{
  const now=new Date("2026-10-28T12:00:00Z");
  const base={keyword:"boots",country:"US",device:"desktop",engine:"google"};
  const url="https://shop.example/products/boots";
  const previous={...base,position:4,observedAt:new Date("2026-10-23T12:00:00Z"),targetUrl:url};
  const confirmation={...base,position:9,observedAt:new Date("2026-10-24T12:00:00Z"),targetUrl:url};
  const drop={...base,position:12,observedAt:new Date("2026-10-25T12:00:00Z"),targetUrl:url};
  const [alert]=buildRankTasks([drop,confirmation,previous],now);
  assert.ok(alert);
  const recovered={...base,position:5,observedAt:new Date("2026-10-26T12:00:00Z"),targetUrl:url+"#size"};
  assert.equal(rankingDropHasRecovered(alert.sourceKey,alert.evidence,[drop,previous,recovered],now),true);
  for(const observations of [
    [drop,previous],
    [drop,previous,{...recovered,position:7}],
    [drop,previous,{...recovered,position:null,targetUrl:""}],
    [drop,previous,{...recovered,targetUrl:"https://shop.example/collections/boots"}],
    [drop,previous,{...recovered,keyword:"sneakers"}],
    [drop,previous,recovered,{...recovered,observedAt:new Date("2026-10-27T12:00:00Z"),targetUrl:"https://shop.example/collections/boots"}],
  ]) assert.equal(rankingDropHasRecovered(alert.sourceKey,alert.evidence,observations,now),false);
  assert.equal(rankingDropHasRecovered(alert.sourceKey,alert.evidence,[recovered],new Date("2026-11-20T12:00:00Z")),false);
  assert.equal(rankingDropHasRecovered(alert.sourceKey,alert.evidence,[recovered],new Date("2026-10-25T12:00:00Z")),false);
  assert.equal(rankingDropHasRecovered(alert.sourceKey,"{}",[recovered],now),false);
  assert.equal(rankingDropHasRecovered(rankIncidentKey("sneakers|US|desktop|google",url),alert.evidence,[recovered],now),false);
});

test("manager retires recovered SERP alerts but preserves accepted decisions and new drops",async()=>{
  const shop="manager-rank-recovery-"+randomUUID()+".myshopify.com";
  await db.storeConfig.create({data:{shop}});
  const rank=(keyword:string,position:number,date:string)=>({
    shop,keyword,position,engine:"google",country:"US",device:"desktop",
    targetUrl:"https://shop.example/products/"+keyword,
    observedAt:new Date(date)
  });
  try {
    await db.seoRankObservation.createMany({data:[
      rank("boots",4,"2026-10-23T12:00:00Z"),
      rank("boots",9,"2026-10-24T12:00:00Z"),
      rank("boots",12,"2026-10-25T12:00:00Z"),
      rank("sneakers",3,"2026-10-23T12:00:00Z"),
      rank("sneakers",7,"2026-10-24T12:00:00Z"),
      rank("sneakers",10,"2026-10-25T12:00:00Z")
    ]});
    await syncManagerTasks(shop,[],new Date("2026-10-28T12:00:00Z"));
    const alerts=await db.storeRecommendation.findMany({where:{shop,kind:"ranking_drop"}});
    assert.equal(alerts.length,2);
    const boots=alerts.find(a=>a.title.includes("boots"))!;
    const sneakers=alerts.find(a=>a.title.includes("sneakers"))!;
    assert.equal(boots.status,"pending");
    await db.storeRecommendation.update({where:{id:sneakers.id},data:{status:"approved"}});
    await db.seoRankObservation.createMany({data:[
      rank("boots",5,"2026-10-26T12:00:00Z"),
      rank("sneakers",4,"2026-10-26T12:00:00Z")
    ]});
    await syncManagerTasks(shop,[],new Date("2026-10-28T12:00:00Z"));
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:boots.id}})).status,"superseded");
    assert.equal((await db.storeRecommendation.findUniqueOrThrow({where:{id:sneakers.id}})).status,"approved");
    await db.seoRankObservation.create({data:rank("boots",15,"2026-10-27T12:00:00Z")});
    await syncManagerTasks(shop,[],new Date("2026-10-28T12:00:00Z"));
    assert.equal((await db.storeRecommendation.count({where:{shop,kind:"ranking_drop",status:"pending"}})),0,
      "one post-recovery rank dip is not a confirmed repeat decline");
    await db.seoRankObservation.create({data:rank("boots",16,"2026-10-28T12:00:00Z")});
    await syncManagerTasks(shop,[],new Date("2026-10-29T12:00:00Z"));
    const latest=await db.storeRecommendation.findMany({where:{shop,kind:"ranking_drop"}});
    assert.equal(latest.filter(a=>a.status==="pending").length,1,
      "a later independently confirmed decline reopens the same incident");
    assert.equal(latest.length,2,"recovery and recurrence must not grow the task count");
    const reopened=await db.storeRecommendation.findUniqueOrThrow({where:{id:boots.id}});
    assert.equal(reopened.status,"pending");
    assert.equal(JSON.parse(reopened.evidence).latestAt,"2026-10-28T12:00:00.000Z");
  }finally {
    await db.storeActivity.deleteMany({where:{shop}});
    await db.storeRecommendation.deleteMany({where:{shop}});
    await db.seoRankObservation.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
});


test("repeated same-page rank declines have stable incident identity and preserve the first baseline",async()=>{
  const shop="rank-incident-"+randomUUID()+".myshopify.com";
  const now=new Date("2026-10-28T18:00:00Z");
  const rank=(position:number,date:string,keyword="boots",url="https://shop.example/products/boots")=>({
    shop,keyword,position,engine:"google",country:"US",device:"desktop",
    targetUrl:url,observedAt:new Date(date)
  });
  await db.storeConfig.create({data:{shop}});
  try {
    const first=[
      rank(4,"2026-10-20T12:00:00Z"),
      rank(9,"2026-10-21T12:00:00Z"),
      rank(12,"2026-10-22T12:00:00Z")
    ];
    await db.seoRankObservation.createMany({data:first});
    await syncManagerTasks(shop,[],now);
    const original=await db.storeRecommendation.findFirstOrThrow({
      where:{shop,kind:"ranking_drop"}
    });
    assert.match(original.sourceKey,/^rank-incident:v2:[a-f0-9]{64}$/);
    assert.equal(JSON.parse(original.evidence).previousRank,4);
    for(const [position,date] of [
      [15,"2026-10-23T12:00:00Z"],
      [18,"2026-10-24T12:00:00Z"],
      [21,"2026-10-25T12:00:00Z"]
    ] as const){
      await db.seoRankObservation.create({data:rank(position,date)});
      await syncManagerTasks(shop,[],now);
      assert.equal(await db.storeRecommendation.count({where:{shop,kind:"ranking_drop"}}),1,
        "each additional confirmed worsening must reuse the original incident");
    }
    const after=await db.storeRecommendation.findMany({where:{shop,kind:"ranking_drop"}});
    assert.equal(after.length,1,"worsening each day must not flood the merchant inbox");
    assert.equal(after[0].id,original.id);
    assert.equal(after[0].evidence,original.evidence,
      "freeze the first observed baseline and rationale until recovery");
    // A merchant dismissal must not be undone by another scrape.
    await db.storeRecommendation.update({where:{id:original.id},data:{status:"dismissed"}});
    await db.seoRankObservation.create({data:rank(24,"2026-10-26T12:00:00Z")});
    await syncManagerTasks(shop,[],now);
    const dismissed=await db.storeRecommendation.findMany({where:{shop,kind:"ranking_drop"}});
    assert.equal(dismissed.length,1);
    assert.equal(dismissed[0].status,"dismissed");
    // Different search context or actual landing page must not collide.
    const url="https://shop.example/products/boots?variant=blue";
    assert.notEqual(rankIncidentKey("boots|US|desktop|google",url),original.sourceKey);
    assert.notEqual(rankIncidentKey("boots|CA|desktop|google",first[0].targetUrl),original.sourceKey);
    assert.equal(rankIncidentKey("boots|US|desktop|google",first[0].targetUrl+"#details"),original.sourceKey);
  }finally {
    await db.storeRecommendation.deleteMany({where:{shop}});
    await db.seoRankObservation.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
});

test("historical timestamp-keyed ranking alerts still support evidence-based recovery",()=>{
  const now=new Date("2026-10-28T12:00:00Z");
  const url="https://shop.example/products/boots";
  const market="boots|US|desktop|google";
  const latestAt="2026-10-25T12:00:00.000Z";
  const oldKey="rank:"+market+":"+latestAt;
  const evidence=JSON.stringify({source:"brightdata-serp",latestAt,url,previousRank:4});
  const recovered={keyword:"boots",country:"US",device:"desktop",engine:"google",
    position:5,targetUrl:url,observedAt:new Date("2026-10-26T12:00:00Z")};
  assert.equal(rankingDropHasRecovered(oldKey,evidence,[recovered],now),true);
  assert.equal(rankingDropHasRecovered(oldKey.replace("US","CA"),evidence,[recovered],now),false);
});

test("manager warns instead of claiming a malformed Shopify catalog is empty",async()=>{
  const malformed = [
    {data: {products: null}},
    {data: {products: {nodes: null}}},
    {data: {products: {nodes: [{id:"partial",title:"Boots"}]}}},
    {errors: [{message:"denied"}], data: {products: {nodes: []}}},
  ];
  for (const payload of malformed) {
    const admin = {graphql: async()=>({json:async()=>payload})};
    const result = await readMerchantProductSample(admin);
    assert.deepEqual(result.products, []);
    assert.match(result.warning, /Catalog unavailable/i);
  }
  const empty = await readMerchantProductSample({
    graphql: async()=>({json:async()=>({data:{products:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}})})
  });
  assert.deepEqual(empty.products, []);
  assert.equal(empty.warning, "");
});

test("manager never presents a successful first page as complete after a second-page failure", async () => {
  let calls = 0;
  const admin = {graphql: async () => ({
    json: async () => ++calls === 1
      ? {data: {products: {
          nodes: [{id: "gid://shopify/Product/1", title: "Boots", description: "",
            onlineStoreUrl: "https://shop.example/products/boots", seo: null}],
          pageInfo: {hasNextPage: true, endCursor: "next-page"}
        }}}
      : {errors: [{message: "Shopify API throttled"}], data: {products: null}}
  })};
  const sample = await readMerchantProductSample(admin);
  assert.equal(calls, 2);
  assert.deepEqual(sample.products, []);
  assert.match(sample.warning, /Catalog unavailable/);
});
