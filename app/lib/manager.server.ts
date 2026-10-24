import db from "../db.server";
import { auditProductSeo, type SeoProduct } from "./seo";
import { buildBlogTasks, buildRankTasks, buildSeoTasks, type SuggestedTask } from "./manager";

export async function readMerchantProductSample(admin:{graphql:Function}):Promise<{products:SeoProduct[];warning:string}> {
  try{
    const res=await admin.graphql(`#graphql query ManagerSeoSample {
      products(first: 50, query: "status:active") {
        nodes { id title description onlineStoreUrl seo { title description } }
      }
    }`);
    const json:any=await res.json();
    if(json.errors?.length)throw new Error("Shopify product API returned errors");
    return {products:(json.data?.products?.nodes||[]).map((p:any)=>({
      id:String(p.id||""),title:String(p.title||""),description:String(p.description||""),
      url:typeof p.onlineStoreUrl==="string"?p.onlineStoreUrl:null,
      seo:p.seo?{title:p.seo.title??null,description:p.seo.description??null}:null,
    })),warning:""};
  }catch(e){return {products:[],warning:"Catalog unavailable; product recommendations may be incomplete."};}
}

export async function syncManagerTasks(shop:string, products:SeoProduct[]) {
  const [drafts,ranks]=await Promise.all([
    db.articleDraft.findMany({where:{shop,status:{in:["ready","needs_review"]}},take:30,orderBy:{createdAt:"desc"}}),
    db.seoRankObservation.findMany({where:{shop},take:300,orderBy:{observedAt:"desc"},
      select:{keyword:true,position:true,country:true,device:true,engine:true,targetUrl:true,observedAt:true}})
  ]);
  const tasks:SuggestedTask[]=[
    ...buildBlogTasks(drafts),...buildSeoTasks(auditProductSeo(products)),...buildRankTasks(ranks)
  ];
  // Insert only; reviewed/dismissed recommendations never reopen on refresh.
  // Unique(shop,sourceKey) makes concurrent page loads idempotent.
  for(const task of tasks.slice(0,100)){
    await db.storeRecommendation.upsert({
      where:{shop_sourceKey:{shop,sourceKey:task.sourceKey}},
      create:{shop,...task},
      update:{}, // never silently change the item the merchant has reviewed
    });
  }
  // Auto-resolve stale content items that were actually published or rejected elsewhere.
  const liveDraftIds=new Set(drafts.map(d=>d.id));
  const pendingContent=await db.storeRecommendation.findMany({
    where:{shop,agent:"content",status:"pending"},select:{id:true,targetId:true}
  });
  for(const old of pendingContent){
    if(liveDraftIds.has(old.targetId)) continue;
    await db.storeRecommendation.updateMany({where:{id:old.id,shop,status:"pending"},data:{status:"resolved",decidedAt:new Date()}});
  }
  return tasks.length;
}

export async function logStoreAction(shop:string,recommendationId:string|null,action:string,outcome:string,detail="") {
  await db.storeActivity.create({data:{shop,recommendationId,action,outcome,detail:detail.slice(0,500)}});
}
