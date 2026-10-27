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

/**
 * A manager sync may finish reading Shopify products after the app was
 * uninstalled. Serialize every recommendation write with merchant redaction:
 * lock StoreConfig first, then read evidence and write recommendations within
 * the same transaction. Never create orphaned recommendations for a deleted
 * shop. Keep external Shopify calls outside this transaction.
 */
export async function syncManagerTasks(shop:string, products:SeoProduct[]) {
  return db.$transaction(async tx => {
    const active=await tx.storeConfig.updateMany({
      where:{shop},data:{updatedAt:new Date()}
    });
    if(active.count!==1)return 0;
    const [drafts,ranks]=await Promise.all([
      tx.articleDraft.findMany({where:{shop,status:{in:["ready","needs_review"]}},take:30,orderBy:{createdAt:"desc"}}),
      tx.seoRankObservation.findMany({where:{shop},take:300,orderBy:{observedAt:"desc"},
        select:{keyword:true,position:true,country:true,device:true,engine:true,targetUrl:true,observedAt:true}})
    ]);
    const tasks:SuggestedTask[]=[
      ...buildBlogTasks(drafts),...buildSeoTasks(auditProductSeo(products)),...buildRankTasks(ranks)
    ];
    // Insert only; reviewed/dismissed recommendations never reopen on refresh.
    // Unique(shop,sourceKey) makes concurrent page loads idempotent.
    for(const task of tasks.slice(0,100)){
      await tx.storeRecommendation.upsert({
        where:{shop_sourceKey:{shop,sourceKey:task.sourceKey}},
        create:{shop,...task},
        update:{},
      });
    }
    // Resolve stale pending content items without changing merchant decisions.
    const liveDraftIds=new Set(drafts.map(d=>d.id));
    const pendingContent=await tx.storeRecommendation.findMany({
      where:{shop,agent:"content",status:"pending"},select:{id:true,targetId:true}
    });
    for(const old of pendingContent){
      if(liveDraftIds.has(old.targetId))continue;
      await tx.storeRecommendation.updateMany({
        where:{id:old.id,shop,status:"pending"},
        data:{status:"resolved",decidedAt:new Date()}
      });
    }
    return tasks.length;
  },{timeout:20_000});
}

/**
 * Audit logging is also a merchant-owned write. A delayed action response
 * must not recreate activity after app/uninstalled or shop/redact.
 */
export async function logStoreAction(shop:string,recommendationId:string|null,action:string,outcome:string,detail="",actorId?:string) {
  await db.$transaction(async tx=>{
    const active=await tx.storeConfig.updateMany({
      where:{shop},data:{updatedAt:new Date()}
    });
    if(active.count!==1)return;
    await tx.storeActivity.create({
      data:{shop,recommendationId,action,outcome,actorId,detail:detail.slice(0,500)}
    });
  });
}
