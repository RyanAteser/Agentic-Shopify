import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authorizedBridge } from "../lib/agent.server";
import { readMerchantProductSample, syncManagerTasks, logStoreAction } from "../lib/manager.server";

/**
 * Read-only background coordinator. n8n may invoke this route, but cannot
 * modify Shopify products, send messages, or publish content.
 */
export const action=async ({request}:ActionFunctionArgs)=>{
  if(request.method!=="POST")return Response.json({error:"Method not allowed"},{status:405});
  if(!authorizedBridge(request))return Response.json({error:"Unauthorized"},{status:401});
  const now=new Date();
  const due=new Date(now.getTime()-24*3600_000);
  // Oldest/unscanned stores first; cap work per execution.
  const configs=await db.storeConfig.findMany({
    where:{OR:[{lastManagerSyncAt:null},{lastManagerSyncAt:{lt:due}}]},
    orderBy:{lastManagerSyncAt:"asc"},take:10,select:{shop:true,lastManagerSyncAt:true}
  });
  const results:{shop:string;status:string;count?:number}[]=[];
  for(const config of configs){
    const claimed=await db.storeConfig.updateMany({
      where:{shop:config.shop,lastManagerSyncAt:config.lastManagerSyncAt},
      data:{lastManagerSyncAt:now}
    });
    if(!claimed.count)continue;
    try{
      // Offline Admin requires a previously authorized merchant session.
      const {unauthenticated}=await import("../shopify.server");
      const {admin}=await unauthenticated.admin(config.shop);
      const {products,warning}=await readMerchantProductSample(admin);
      const count=await syncManagerTasks(config.shop,products);
      results.push({shop:config.shop,status:warning?"partial":"ok",count});
    }catch(error){
      // Revert a failed claim so the next schedule can retry.
      await db.storeConfig.updateMany({
        where:{shop:config.shop,lastManagerSyncAt:now},
        data:{lastManagerSyncAt:config.lastManagerSyncAt}
      });
      console.error("Manager sync failed for",config.shop,error instanceof Error?error.message:"unknown");
      results.push({shop:config.shop,status:"failed"});
    }
  }
  // Only aggregate counts returned; no tenant data in response.
  const completed=results.filter(x=>x.status==="ok").length;
  const partial=results.filter(x=>x.status==="partial").length;
  const failed=results.filter(x=>x.status==="failed").length;
  return Response.json({processed:results.length,completed,partial,failed});
};
