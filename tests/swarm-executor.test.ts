import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";
import {resizeSwarmRole,queueSwarmResearch} from "../app/lib/swarm-roster.server";
import {reserveBoundedSwarmCase,executeBoundedSwarmCase,closeExpiredSwarmRun}
  from "../app/lib/swarm-executor.server";
import {planSixCallResearch,buildWorkerPrompt,PILOT_MAX_MODEL_CALLS,
  type BoundedModelProvider,type SwarmPhase} from "../app/lib/swarm-execution-policy";
import {geminiBoundedProvider} from "../app/lib/swarm-gemini.server";

const testEnv=(shop:string)=>({
  SWARM_WORKER_ENABLED:"true",SWARM_EXECUTION_ENABLED:"true",
  SWARM_WORKER_ALLOWED_SHOP:shop
});
async function seeded(){
  const shop="worker-"+randomUUID()+".myshopify.com";
  const sessionId="worker-session-"+randomUUID();
  await db.session.create({data:{
    id:sessionId,shop,state:"test",accessToken:"synthetic-in-test",
    scope:"read_products",isOnline:false
  }});
  await db.storeConfig.create({data:{shop}});
  await resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"});
  const caseInput={shop,sessionId,plan:"free" as const,role:"seo",
    title:"Explore new nonbrand search opportunities",
    hypothesis:"Product information gaps might reduce search discovery for valuable questions.",
    metric:"Compare observed nonbrand Search Console clicks with unchanged similar pages.",
    rejectionRule:"Reject if held-out relative improvement is absent or negative."};
  const queued=await queueSwarmResearch(caseInput);
  return {shop,sessionId,caseId:queued.id,caseInput};
}
function fakeModel(errorOnCall=-1):BoundedModelProvider & {prompts:{phase:SwarmPhase;prompt:string}[]} {
  let n=0;
  const prompts:{phase:SwarmPhase;prompt:string}[]=[];
  return {providerName:"fixture-not-live",modelName:"deterministic-test",
    prompts,async generate(input){
      if(n++===errorOnCall)throw new Error("Simulated ambiguous provider failure");
      prompts.push({phase:input.phase,prompt:input.prompt});
      return {
        text:"This is an unverified research observation, requiring independent merchant evidence.",
        evidenceUrls:[],falsifier:"Reject unless a held-out cohort shows positive net improvement.",
        verdict:input.phase==="skeptic_verdict"?"supported":undefined,
        inputTokens:102,outputTokens:38,model:"deterministic-test"
      };
    }};
}

test("two specialists plus skeptic complete six staged calls with a forced unverified abstention",async()=>{
  const {shop,caseId}=await seeded();
  const provider=fakeModel();
  try{
    const result=await executeBoundedSwarmCase({shop,caseId,provider,env:testEnv(shop)});
    assert.equal(result.status,"completed");
    assert.equal(result.caseStatus,"needs_evidence");
    assert.equal(result.callsAttempted,6);
    assert.equal(result.callsCommitted,6);
    assert.equal(result.inputTokens,612);
    assert.equal(result.outputTokens,228);
    assert.deepEqual(provider.prompts.map(x=>x.phase),[
      "independent_hypothesis","independent_evidence","skeptic_challenge",
      "researcher_revision","skeptic_recheck","skeptic_verdict"
    ]);
    assert.equal(JSON.parse(provider.prompts[0].prompt).previousDebate.length,0);
    assert.equal(JSON.parse(provider.prompts[1].prompt).previousDebate.length,0,
      "independent specialist gets no previous specialist response");
    assert.equal(JSON.parse(provider.prompts[2].prompt).previousDebate.length,2);
    const usage=await db.swarmUsageMonth.findFirstOrThrow({where:{shop}});
    assert.equal(usage.consumed,6);
    assert.equal(usage.reserved,0);
    const messages=await db.swarmMessage.findMany({where:{shop,caseId}});
    assert.equal(messages.length,9);
    const verdict=messages.find(x=>x.kind==="verdict");
    assert.equal(verdict?.verdict,"abstain","unverified citations cannot produce an approval");
    assert.equal(await db.storeRecommendation.count({where:{shop}}),0);
    await assert.rejects(
      executeBoundedSwarmCase({shop,caseId,provider,env:testEnv(shop)}),
      /one execution attempt/);
    assert.equal(provider.prompts.length,PILOT_MAX_MODEL_CALLS);
  }finally{await eraseMerchantData(shop)}
  assert.equal(await db.swarmInvocation.count({where:{shop}}),0);
  assert.equal(await db.swarmExecution.count({where:{shop}}),0);
  assert.equal(await db.swarmUsageMonth.count({where:{shop}}),0);
});

test("uncertain third model call consumes one attempt, releases unused capacity and never retries",async()=>{
  const {shop,caseId}=await seeded();const provider=fakeModel(2);
  try{
    const result=await executeBoundedSwarmCase({shop,caseId,provider,env:testEnv(shop)});
    assert.equal(result.status,"blocked_uncertain");
    assert.equal(result.callsAttempted,3);
    assert.equal(result.callsCommitted,2);
    const usage=await db.swarmUsageMonth.findFirstOrThrow({where:{shop}});
    assert.deepEqual({reserved:usage.reserved,consumed:usage.consumed},{reserved:0,consumed:3});
    const invocations=await db.swarmInvocation.findMany({where:{shop},orderBy:{ordinal:"asc"}});
    assert.deepEqual(invocations.map(x=>x.status),["committed","committed","uncertain"]);
    assert.equal((await db.swarmCase.findUniqueOrThrow({where:{id:caseId}})).status,"paused");
    await assert.rejects(executeBoundedSwarmCase({shop,caseId,provider,env:testEnv(shop)}),
      /one execution attempt/);
    assert.equal(provider.prompts.length,2);
  }finally{await eraseMerchantData(shop)}
});

test("explicit operator shop, pilot boundary and monthly reservations all fail closed",async()=>{
  const {shop,caseId}=await seeded();
  const provider=fakeModel();
  try{
    await assert.rejects(reserveBoundedSwarmCase({
      shop,caseId,provider,env:{...testEnv(shop),SWARM_WORKER_ALLOWED_SHOP:"foreign.myshopify.com"}}),
      /not enabled/);
    await assert.rejects(reserveBoundedSwarmCase({
      shop,caseId,provider,env:{...testEnv(shop),AGENTIC_PILOT_MODE:"read_only"}}),
      /read-only/);
    await db.swarmUsageMonth.create({data:{shop,month:new Date().toISOString().slice(0,7),consumed:20}});
    await assert.rejects(reserveBoundedSwarmCase({shop,caseId,provider,env:testEnv(shop)}),
      /credit cap/);
    assert.equal(await db.swarmExecution.count({where:{shop}}),0);
    assert.equal(provider.prompts.length,0);
  }finally{await eraseMerchantData(shop)}
});

test("expired worker lease reconciles without sending model requests",async()=>{
  const {shop,caseId}=await seeded();const provider=fakeModel();
  try{
    const reserved=await reserveBoundedSwarmCase({shop,caseId,provider,env:testEnv(shop)});
    await assert.rejects(closeExpiredSwarmRun({shop,runId:reserved.id,env:testEnv(shop)}),/not abandoned/);
    await db.swarmExecution.update({where:{id:reserved.id},
      data:{leaseExpiresAt:new Date(Date.now()-60000)}});
    const closed=await closeExpiredSwarmRun({shop,runId:reserved.id,env:testEnv(shop)});
    assert.equal(closed.status,"blocked_uncertain");
    assert.equal(closed.callsAttempted,0);
    const meter=await db.swarmUsageMonth.findFirstOrThrow({where:{shop}});
    assert.equal(meter.reserved,0);
    assert.equal(meter.consumed,0);
    assert.equal(provider.prompts.length,0);
  }finally{await eraseMerchantData(shop)}
});

test("bounded policy refuses larger teams and unbounded prompts",()=>{
  const a=(id:string,kind:string)=>({id,role:"seo",kind,status:"active",specialty:"A research lane"});
  assert.throws(()=>planSixCallResearch([a("a","specialist"),a("b","specialist"),
    a("c","specialist"),a("d","skeptic")]),/exactly two/);
  assert.throws(()=>buildWorkerPrompt({phase:"independent_hypothesis",
    title:"A".repeat(12000),hypothesis:"Evidence gap",metric:"Clicks",
    rejectionRule:"No uplift",specialty:"Indexing",prior:[]}),/input bound/);
});

test("real Gemini transport requires explicit opt-in and a pinned model",()=>{
  assert.throws(()=>geminiBoundedProvider({SWARM_GEMINI_MODEL:"gemini-3.8-flash"}),/opt-in/);
  assert.throws(()=>geminiBoundedProvider({SWARM_GEMINI_MODEL:"custom-dangerous-model",
    SWARM_WORKER_ENABLED:"true",SWARM_ENABLE_PAID_MODEL_CALLS:"true",GEMINI_API_KEY:"x".repeat(32)}),
    /explicit allowed/);
});
