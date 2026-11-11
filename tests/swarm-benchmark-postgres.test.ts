import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";
import {resizeSwarmRole,queueSwarmResearch} from "../app/lib/swarm-roster.server";
import {executeSingleAgentBenchmark} from "../app/lib/swarm-benchmark.server";
import {BENCHMARK_CASES,benchmarkBrief} from "../app/lib/swarm-benchmark-policy";
import {SNAPSHOT_SOURCE} from "../app/lib/swarm-evidence.server";
import type {BoundedModelProvider} from "../app/lib/swarm-execution-policy";

test("PostgreSQL two simultaneous single-agent attempts cannot exceed the final remaining monthly credit",{
  skip:!process.env.DATABASE_URL
},async()=>{
  const shop="pg-benchmark-"+randomUUID()+".myshopify.com";
  const sessionId="pg-bench-"+randomUUID();
  const month=new Date().toISOString().slice(0,7);
  const provider:BoundedModelProvider={providerName:"offline-fixture",modelName:"fake",
    generate:async()=>({
      text:"ANSWER: NO\nThe published snapshot contradicts the depublication assertion.",
      evidenceUrls:[],falsifier:"Reject if published active count equals zero.",
      inputTokens:100,outputTokens:25,model:"fake"
    })};
  const env={SWARM_WORKER_ENABLED:"true",SWARM_EXECUTION_ENABLED:"true",
    SWARM_BENCHMARK_ENABLED:"true",SWARM_WORKER_ALLOWED_SHOP:shop};
  await db.storeConfig.create({data:{shop}});
  await db.session.create({data:{id:sessionId,shop,state:"test",isOnline:false,
    scope:"read_products",accessToken:"synthetic-test"}});
  try{
    await resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"});
    const snapshot={source:SNAPSHOT_SOURCE,shop,collectedAt:new Date().toISOString(),
      storefrontPasswordEnabled:true,allProductsSampled:18,activeProductsInSample:16,
      allProductsHasNextPage:false,allProductsWithOnlineStoreUrl:0,
      publishedProductsSampled:13,publishedActiveProductsInSample:13,
      publishedProductsHasNextPage:false,publishedProductsWithOnlineStoreUrl:0} as const;
    const ids=[];
    for(let i=0;i<2;i++){
      const x=await queueSwarmResearch({shop,sessionId,role:"seo",plan:"free",
        ...benchmarkBrief(BENCHMARK_CASES[0]),trustedSnapshot:snapshot});
      ids.push(x.id);
    }
    await db.swarmUsageMonth.create({data:{shop,month,consumed:24}});
    const attempts=await Promise.allSettled(ids.map(caseId=>
      executeSingleAgentBenchmark({shop,caseId,provider,env})));
    const completed=attempts.filter(x=>x.status==="fulfilled"&&x.value.status==="completed");
    assert.equal(completed.length,1);
    const ledger=await db.swarmUsageMonth.findUniqueOrThrow({where:{shop_month:{shop,month}}});
    assert.equal(ledger.consumed,25);
    assert.equal(ledger.reserved,0);
    assert.equal(await db.swarmInvocation.count({where:{shop,status:"committed"}}),1);
  }finally{await eraseMerchantData(shop)}
});
