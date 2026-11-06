import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";
import {queueSwarmResearch,resizeSwarmRole} from "../app/lib/swarm-roster.server";
import {executeAdaptiveSkepticCase} from "../app/lib/adaptive-skeptic.server";
import {ADAPTIVE_GATE_SENDER} from "../app/lib/swarm-executor.server";
import {SNAPSHOT_SOURCE} from "../app/lib/swarm-evidence.server";
import type {BoundedModelProvider,SwarmPhase} from "../app/lib/swarm-execution-policy";

const env=(shop:string)=>({
  SWARM_ADAPTIVE_ENABLED:"true",
  SWARM_WORKER_ENABLED:"true",SWARM_EXECUTION_ENABLED:"true",
  SWARM_WORKER_ALLOWED_SHOP:shop
});
async function setup(external=false){
  const shop="adaptive-"+randomUUID()+".myshopify.com";
  const sessionId="adaptive-session-"+randomUUID();
  await db.storeConfig.create({data:{shop}});
  await db.session.create({data:{
    id:sessionId,shop,state:"fake",isOnline:false,
    accessToken:"fake-unit-test-secret",scope:"read_products"
  }});
  await resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"});
  const spec={shop,sessionId,role:"seo",plan:"free" as const,
    title:external?"Does Google index these products?":"Do null URLs prove no active channel publication?",
    hypothesis:external?"Null URLs do not establish Google indexing.":"Null URL fields alone do not establish channel publication.",
    metric:external?"Validate Google indexing with URL Inspection.":"Compare active published products against null URLs.",
    rejectionRule:"Reject if verified independent evidence contradicts the hypothesis.",
    trustedSnapshot:{
      source:SNAPSHOT_SOURCE,shop,collectedAt:new Date().toISOString(),
      storefrontPasswordEnabled:true,allProductsSampled:18,
      allProductsHasNextPage:false,activeProductsInSample:16,
      allProductsWithOnlineStoreUrl:0,publishedProductsSampled:13,
      publishedProductsHasNextPage:false,publishedActiveProductsInSample:13,
      publishedProductsWithOnlineStoreUrl:0
    }
  };
  const c=await queueSwarmResearch(spec);
  return {shop,caseId:c.id};
}
function fixture(params:{escalate?:boolean;failOn?:number}={}):BoundedModelProvider & {phases:SwarmPhase[]}{
  const phases:SwarmPhase[]=[];
  return {providerName:"fake-no-cost",modelName:"fixture",phases,
    async generate(request){
      phases.push(request.phase);
      if(params.failOn===phases.length)throw new Error("model response lost");
      const label=params.escalate?"INSUFFICIENT":"NO";
      return {text:"ANSWER: "+label+"\npublishedActiveProductsInSample is 13 despite null onlineStoreUrl; this alone proves nothing about Google's index.",
        evidenceUrls:[],falsifier:"Reject if trusted Admin evidence later shows no active published products.",
        verdict:request.phase==="skeptic_verdict"?"supported":undefined,
        inputTokens:100,outputTokens:45,model:"fixture"};
    }};
}
test("one grounded source-linked specialist exits after one request, retains an unapproved decision",async()=>{
  const {shop,caseId}=await setup();const p=fixture();
  try{
    const r=await executeAdaptiveSkepticCase({shop,caseId,provider:p,env:env(shop)});
    assert.equal(r.status,"completed");
    assert.equal(r.path,"single_grounded_specialist");
    assert.deepEqual(r.reasons,[]);
    assert.equal(r.callsAttempted,1);
    assert.equal(r.callsCommitted,1);
    assert.equal(r.resultIsApproved,false);
    assert.deepEqual(p.phases,["independent_hypothesis"]);
    const run=await db.swarmExecution.findUniqueOrThrow({where:{caseId}});
    assert.equal(run.maxCalls,3);
    assert.equal(run.plan,"adaptive_free");
    const caseStatus=(await db.swarmCase.findUniqueOrThrow({where:{id:caseId}})).status;
    assert.equal(caseStatus,"needs_evidence");
    const router=await db.swarmMessage.findFirstOrThrow({where:{shop,caseId,senderId:ADAPTIVE_GATE_SENDER}});
    const gate=JSON.parse(router.body);
    assert.equal(gate.escalate,false);
    assert.equal(gate.merchantWritesAllowed,false);
    const u=await db.swarmUsageMonth.findFirstOrThrow({where:{shop}});
    assert.equal(u.consumed,1);
    assert.equal(u.reserved,0);
    await assert.rejects(executeAdaptiveSkepticCase({shop,caseId,provider:p,env:env(shop)}),
      /one execution attempt|unavailable/);
    assert.equal(p.phases.length,1);
  }finally{await eraseMerchantData(shop)}
  assert.equal(await db.swarmExecution.count({where:{shop}}),0);
  assert.equal(await db.swarmInvocation.count({where:{shop}}),0);
});
test("external outcomes escalate into a challenge and independent skeptic abstention",async()=>{
  const {shop,caseId}=await setup(true);const p=fixture({escalate:true});
  try{
    const result=await executeAdaptiveSkepticCase({shop,caseId,provider:p,env:env(shop)});
    assert.equal(result.status,"completed");
    assert.equal(result.path,"specialist_then_skeptic");
    assert.equal(result.callsAttempted,3);
    assert.equal(result.callsCommitted,3);
    assert.ok(result.reasons.includes("EXTERNAL_OUTCOME_UNVERIFIED"));
    assert.deepEqual(p.phases,["independent_hypothesis","skeptic_challenge","skeptic_verdict"]);
    const u=await db.swarmUsageMonth.findFirstOrThrow({where:{shop}});
    assert.equal(u.consumed,3);
    assert.equal(u.reserved,0);
    const v=await db.swarmMessage.findFirstOrThrow({where:{shop,caseId,kind:"verdict"}});
    assert.equal(v.verdict,"abstain","unsupported positive model verdict must never auto-approve");
    assert.equal((await db.swarmCase.findUniqueOrThrow({where:{id:caseId}})).status,"needs_evidence");
    assert.equal(await db.storeRecommendation.count({where:{shop}}),0);
  }finally{await eraseMerchantData(shop)}
});
test("uncertain second call stops the run, uses exactly two credits, cannot replay",async()=>{
  const {shop,caseId}=await setup(true);const p=fixture({escalate:true,failOn:2});
  try{
    const r=await executeAdaptiveSkepticCase({shop,caseId,provider:p,env:env(shop)});
    assert.equal(r.status,"blocked_uncertain");
    assert.equal(r.callsAttempted,2);
    assert.equal(r.callsCommitted,1);
    const inv=await db.swarmInvocation.findMany({where:{shop},orderBy:{ordinal:"asc"}});
    assert.deepEqual(inv.map(x=>x.status),["committed","uncertain"]);
    const meter=await db.swarmUsageMonth.findFirstOrThrow({where:{shop}});
    assert.equal(meter.consumed,2);
    assert.equal(meter.reserved,0);
    assert.equal((await db.swarmCase.findUniqueOrThrow({where:{id:caseId}})).status,"paused");
    await assert.rejects(executeAdaptiveSkepticCase({shop,caseId,provider:p,env:env(shop)}),
      /one execution attempt|unavailable/);
    assert.equal(p.phases.length,2);
  }finally{await eraseMerchantData(shop)}
});
test("operator flags or absent authenticated evidence block without spending",async()=>{
  const {shop,caseId}=await setup();const p=fixture();
  try{
    await assert.rejects(executeAdaptiveSkepticCase({
      shop,caseId,provider:p,env:{...env(shop),SWARM_ADAPTIVE_ENABLED:"false"}
    }),/disabled/);
    await db.swarmMessage.deleteMany({where:{shop,caseId,senderId:"shopify-admin-verified-snapshot"}});
    await assert.rejects(executeAdaptiveSkepticCase({shop,caseId,provider:p,env:env(shop)}),
      /authenticated evidence/);
    assert.equal(await db.swarmUsageMonth.count({where:{shop}}),0);
    assert.equal(p.phases.length,0);
  }finally{await eraseMerchantData(shop)}
});
