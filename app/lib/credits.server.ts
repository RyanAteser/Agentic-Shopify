import db from "../db.server";
import { FREE_LIFETIME_GENERATIONS } from "./pricing";

/**
 * One transaction: reserve a free credit and create the job, or roll both back.
 * Paid entitlements remain disabled until Shopify App Pricing integration.
 */
export async function createCreditedJob(shop:string,topic:string){
  return db.$transaction(async tx=>{
    const claim=await tx.storeConfig.updateMany({
      where:{shop,freeDraftsUsed:{lt:FREE_LIFETIME_GENERATIONS}},
      data:{freeDraftsUsed:{increment:1}}
    });
    if(!claim.count)throw new Error("Free generation limit reached (3 lifetime drafts). Paid plans are not yet available.");
    return tx.contentJob.create({data:{shop,topic,outboxVersion:1}});
  });
}

/**
 * Refund only a definitively rejected job. A network timeout after HTTP POST
 * cannot prove whether n8n accepted the work and must NOT refund automatically.
 */
export async function failCreditedJob(shop:string,id:string,error:unknown){
  return db.$transaction(async tx=>{
    // Lock the merchant row FIRST, matching article callbacks and Shopify
    // redaction. Reversing StoreConfig -> ContentJob would permit a PostgreSQL
    // deadlock when a late callback races a definitive rejection/refund.
    // A deleted shop must not be recreated or refunded after redaction.
    const active=await tx.storeConfig.updateMany({
      where:{shop},data:{updatedAt:new Date()}
    });
    if(active.count!==1)return false;
    const result=await tx.contentJob.updateMany({
      where:{id,shop,status:{in:["queued","running"]}},
      data:{status:"failed",error:String(error).slice(0,400)}
    });
    if(result.count){
      await tx.storeConfig.update({where:{shop},data:{freeDraftsUsed:{decrement:1}}});
    }
    return result.count>0;
  });
}
