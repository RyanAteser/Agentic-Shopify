import db from "../db.server";
import { auditProductSeo, effectiveSeoTitle, isOnlineStoreSeoCandidate, type SeoProduct } from "./seo";
import { buildBlogTasks, buildRankTasks, buildSeoTasks, rankingDropHasRecovered, type SuggestedTask } from "./manager";

export async function readMerchantProductSample(admin:{graphql:Function}):Promise<{products:SeoProduct[];warning:string}> {
  try{
    const res=await admin.graphql(`#graphql query ManagerSeoSample {
      products(first: 50, query: "status:active published_status:published") {
        nodes { id title description onlineStoreUrl seo { title description } }
      }
    }`);
    const json:any=await res.json();
    if(json.errors?.length)throw new Error("Shopify product API returned errors");
    return {products:(json.data?.products?.nodes||[]).map((p:any)=>({
      id:String(p.id||""),title:String(p.title||""),description:String(p.description||""),
      url:typeof p.onlineStoreUrl==="string"?p.onlineStoreUrl:null,
      seo:p.seo?{title:p.seo.title??null,description:p.seo.description??null}:null,
    })).filter(isOnlineStoreSeoCandidate),warning:""};
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
    const seoFindings = auditProductSeo(products);
    const seoTasks = buildSeoTasks(seoFindings);
    const tasks:SuggestedTask[]=[
      ...buildBlogTasks(drafts),...seoTasks,...buildRankTasks(ranks)
    ];
    // Insert only; reviewed/dismissed recommendations never reopen on refresh.
    // Unique(shop,sourceKey) makes concurrent page loads idempotent.
    for(const task of tasks.slice(0,100)){
      await tx.storeRecommendation.upsert({
        where:{shop_sourceKey:{shop,sourceKey:task.sourceKey}},
        create:{shop,...task},
        update:{},
      });
      // Only machine-superseded metadata findings can reopen when the same
      // product is sampled again. Never undo a merchant's manual decision.
      if (task.kind === "seo_review") {
        // Refresh evidence for still-pending tasks without changing merchant
        // approvals/dismissals. A superseded finding may recur.
        await tx.storeRecommendation.updateMany({
          where:{shop,sourceKey:task.sourceKey,status:{in:["pending","superseded"]}},
          data:{status:"pending",decidedAt:null,title:task.title,
            rationale:task.rationale,evidence:task.evidence,priority:task.priority}
        });
      }
    }
    // The catalog is only a sample (up to 50 products). A finding can be
    // retired only if that exact product was inspected on this sync; missing
    // products and failed/empty API reads are NOT evidence of remediation.
    const sampledProducts = new Map(products.map(product => [product.id,product]));
    if (sampledProducts.size) {
      const currentSeoKeys = new Set(seoFindings.map(finding => "seo:" + finding.id));
      const pendingSeo = await tx.storeRecommendation.findMany({
        where:{shop,kind:"seo_review",status:"pending",
          targetId:{in:[...sampledProducts.keys()]}},
        select:{id:true,sourceKey:true,targetId:true,evidence:true}
      });
      for (const old of pendingSeo) {
        if (currentSeoKeys.has(old.sourceKey)) continue;
        if (old.sourceKey.endsWith(":duplicate-title")) {
          // Absence of a peer in a 50-product sample does NOT establish that
          // duplicate titles were fixed. Only a change to this product's
          // previously observed effective title can retire that specific alert.
          let priorTitle:unknown;
          try { priorTitle=JSON.parse(old.evidence).observedTitle; } catch { /* legacy evidence */ }
          const current=sampledProducts.get(old.targetId);
          if (typeof priorTitle!=="string" || !current ||
              effectiveSeoTitle(current).toLocaleLowerCase("en-US")===priorTitle) continue;
        }
        await tx.storeRecommendation.updateMany({
          where:{id:old.id,shop,status:"pending"},
          data:{status:"superseded",decidedAt:new Date()}
        });
      }
    }
    // A ranking drop can recover without any merchant action. Retire only
    // pending alerts supported by a newer, fresh, same-market, same-page
    // observation. The 300-row sample may omit markets; absence is not proof
    // of recovery. Keep approved/dismissed/resolved merchant decisions intact.
    const pendingRank=await tx.storeRecommendation.findMany({
      where:{shop,kind:"ranking_drop",status:"pending"},
      orderBy:{createdAt:"asc"},take:200,
      select:{id:true,sourceKey:true,evidence:true}
    });
    for(const old of pendingRank){
      if(!rankingDropHasRecovered(old.sourceKey,old.evidence,ranks))continue;
      await tx.storeRecommendation.updateMany({
        where:{id:old.id,shop,status:"pending"},
        data:{status:"superseded",decidedAt:new Date()}
      });
    }
    // The 30 most recent drafts are an inbox sample, not a complete inventory.
    // Verify the actual status of older pending recommendations before retiring
    // them; omission from take:30 does not mean the draft was published/deleted.
    const eligibleDraftIds=new Set(drafts.map(d=>d.id));
    const pendingContent=await tx.storeRecommendation.findMany({
      where:{shop,agent:"content",status:"pending"},select:{id:true,targetId:true}
    });
    const unsampledIds=[...new Set(pendingContent
      .map(item=>item.targetId).filter(id=>!eligibleDraftIds.has(id)))];
    // Bound SQL parameters for SQLite and PostgreSQL, even for a long-lived shop.
    for(let i=0;i<unsampledIds.length;i+=200){
      const eligible=await tx.articleDraft.findMany({
        where:{shop,id:{in:unsampledIds.slice(i,i+200)},
          status:{in:["ready","needs_review"]}},
        select:{id:true}
      });
      for(const row of eligible)eligibleDraftIds.add(row.id);
    }
    for(const old of pendingContent){
      if(eligibleDraftIds.has(old.targetId))continue;
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
