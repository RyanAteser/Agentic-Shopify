import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";
import {resizeSwarmRole,queueSwarmResearch} from "../app/lib/swarm-roster.server";
import {reserveBoundedSwarmCase} from "../app/lib/swarm-executor.server";
import type {BoundedModelProvider} from "../app/lib/swarm-execution-policy";

test("PostgreSQL simultaneous paid-call reservations never exceed one merchant's free pilot cap",{
  skip:!process.env.DATABASE_URL
},async()=>{
  const shop="pg-swarm-worker-"+randomUUID()+".myshopify.com";
  const sessionId="test-session-"+randomUUID();
  await db.storeConfig.create({data:{shop}});
  await db.session.create({data:{id:sessionId,shop,state:"fake",
    accessToken:"synthetic-test",isOnline:false,scope:"read_products"}});
  const provider:BoundedModelProvider={providerName:"offline-fixture",modelName:"fake",generate:async()=>{
    throw new Error("Not executed in reservation test");
  }};
  const env={SWARM_WORKER_ENABLED:"true",SWARM_EXECUTION_ENABLED:"true",
    SWARM_WORKER_ALLOWED_SHOP:shop};
  try{
    await resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"});
    const brief={shop,sessionId,role:"seo",plan:"free" as const,
      title:"Bounded parallel quota reservation",
      hypothesis:"Some catalog queries are underserved compared with matched control products.",
      metric:"Measure nonbrand clicks on matched products.",
      rejectionRule:"Reject without positive held-out improvement."};
    const a=await queueSwarmResearch(brief);
    const b=await queueSwarmResearch({...brief,title:"Second independent experiment"});
    const month=new Date().toISOString().slice(0,7);
    await db.swarmUsageMonth.create({data:{shop,month,consumed:15}});
    const results=await Promise.allSettled([a,b].map(x=>
      reserveBoundedSwarmCase({shop,caseId:x.id,provider,env})));
    assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
    const usage=await db.swarmUsageMonth.findUniqueOrThrow({where:{shop_month:{shop,month}}});
    assert.equal(usage.consumed,15);
    assert.equal(usage.reserved,6);
    assert.equal(await db.swarmExecution.count({where:{shop}}),1);
  }finally{await eraseMerchantData(shop)}
});
