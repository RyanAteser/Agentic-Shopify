import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";
import {queueSwarmResearch,resizeSwarmRole} from "../app/lib/swarm-roster.server";
import {reserveBoundedSwarmCase} from "../app/lib/swarm-executor.server";
import {SNAPSHOT_SOURCE} from "../app/lib/swarm-evidence.server";
import type {BoundedModelProvider} from "../app/lib/swarm-execution-policy";

test("PostgreSQL concurrent three-call reservations cannot exceed the last available credits",{
  skip:!process.env.DATABASE_URL
},async()=>{
  const shop="pg-adaptive-"+randomUUID()+".myshopify.com";
  const sessionId="pg-adaptive-sess-"+randomUUID();
  const month=new Date().toISOString().slice(0,7);
  const provider:BoundedModelProvider={providerName:"fixture",modelName:"no-network",
    generate:async()=>{throw new Error("Not part of reservation test")}};
  const env={
    SWARM_WORKER_ENABLED:"true",SWARM_EXECUTION_ENABLED:"true",
    SWARM_ADAPTIVE_ENABLED:"true",SWARM_WORKER_ALLOWED_SHOP:shop
  };
  await db.storeConfig.create({data:{shop}});
  await db.session.create({data:{id:sessionId,shop,isOnline:false,
    state:"synthetic",scope:"read_products",accessToken:"synthetic-not-live"}});
  try{
    await resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"});
    const snapshot={
      source:SNAPSHOT_SOURCE,shop,collectedAt:new Date().toISOString(),
      storefrontPasswordEnabled:true,allProductsSampled:18,
      allProductsHasNextPage:false,activeProductsInSample:16,
      allProductsWithOnlineStoreUrl:0,publishedProductsSampled:13,
      publishedProductsHasNextPage:false,publishedActiveProductsInSample:13,
      publishedProductsWithOnlineStoreUrl:0
    } as const;
    const ids:string[]=[];
    for(let i=0;i<2;i++){
      const result=await queueSwarmResearch({
        shop,sessionId,role:"seo",plan:"free",
        title:"Study source linked null product URL facts "+i,
        hypothesis:"Published active products may lack public URLs.",
        metric:"Use trusted Shopify Admin publication counts.",
        rejectionRule:"Reject if verified counts contradict the hypothesis.",
        trustedSnapshot:snapshot
      });
      ids.push(result.id);
    }
    await db.swarmUsageMonth.create({data:{shop,month,consumed:22}});
    const responses=await Promise.allSettled(ids.map(caseId=>
      reserveBoundedSwarmCase({shop,caseId,provider,env,mode:"adaptive"})));
    assert.equal(responses.filter(x=>x.status==="fulfilled").length,1);
    const u=await db.swarmUsageMonth.findUniqueOrThrow({where:{shop_month:{shop,month}}});
    assert.equal(u.consumed,22);
    assert.equal(u.reserved,3);
    assert.equal(await db.swarmExecution.count({where:{shop,status:"running"}}),1);
  }finally{await eraseMerchantData(shop)}
});
