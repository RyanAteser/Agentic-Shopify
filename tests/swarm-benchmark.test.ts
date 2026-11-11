import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";
import {queueSwarmResearch,resizeSwarmRole} from "../app/lib/swarm-roster.server";
import {executeSingleAgentBenchmark,BENCHMARK_SENDER} from "../app/lib/swarm-benchmark.server";
import {BENCHMARK_CASES,benchmarkBrief,parseBenchmarkAnswer,scoreBenchmarkCase}
  from "../app/lib/swarm-benchmark-policy";
import {SNAPSHOT_SOURCE,type VerifiedShopifySnapshot}
  from "../app/lib/swarm-evidence.server";
import type {BoundedModelProvider} from "../app/lib/swarm-execution-policy";

const frozen=(shop:string):VerifiedShopifySnapshot=>({
  source:SNAPSHOT_SOURCE,shop,collectedAt:new Date().toISOString(),
  storefrontPasswordEnabled:true,allProductsSampled:18,allProductsHasNextPage:false,
  activeProductsInSample:16,allProductsWithOnlineStoreUrl:0,
  publishedProductsSampled:13,publishedProductsHasNextPage:false,
  publishedActiveProductsInSample:13,publishedProductsWithOnlineStoreUrl:0
});
const env=(shop:string)=>({
  SWARM_WORKER_ENABLED:"true",SWARM_EXECUTION_ENABLED:"true",
  SWARM_BENCHMARK_ENABLED:"true",SWARM_WORKER_ALLOWED_SHOP:shop
});
async function seed(){
  const shop="benchmark-"+randomUUID()+".myshopify.com";
  const sessionId="bench-"+randomUUID();
  await db.storeConfig.create({data:{shop}});
  await db.session.create({data:{id:sessionId,shop,scope:"read_products",isOnline:false,
    accessToken:"synthetic-local-test",state:"test"}});
  await resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"});
  const item=await queueSwarmResearch({shop,sessionId,role:"seo",plan:"free",
    ...benchmarkBrief(BENCHMARK_CASES[0]),trustedSnapshot:frozen(shop)});
  return {shop,sessionId,caseId:item.id};
}
const provider=(throwError=false):BoundedModelProvider & {requests:string[]}=>{
  const requests:string[]=[];
  return {providerName:"fixture-nonbillable",modelName:"test-model",requests,
    async generate(request){
      requests.push(request.prompt);
      if(throwError)throw new Error("uncertain delivery");
      return {text:"ANSWER: NO\nVerified counts disprove the blanket depublication claim.",
        evidenceUrls:[],falsifier:"Reject if no active published products exist.",
        inputTokens:102,outputTokens:43,model:"test-model"};
    }};
};

test("pre-registered benchmark rubric parses explicit labels and treats missing labels as failure",()=>{
  const cases=BENCHMARK_CASES;
  assert.equal(cases.length,2);
  assert.equal(parseBenchmarkAnswer("ANSWER: NO\nThis contradicts the assertion."),"NO");
  assert.equal(parseBenchmarkAnswer("  ANSWER: INSUFFICIENT\nMissing GSC."),"INSUFFICIENT");
  assert.equal(parseBenchmarkAnswer("I guess NO"),null);
  assert.equal(parseBenchmarkAnswer("ANSWER: NO, but..."),null);
  const facts=frozen("example.myshopify.com");
  assert.equal(cases[0].expected(facts),"NO");
  assert.equal(cases[1].expected(facts),"INSUFFICIENT");
  for(const c of cases){
    const b=benchmarkBrief(c);
    assert.ok(b.title.length>=8&&b.title.length<=140,c.id);
    assert.ok(b.hypothesis.length>=8&&b.hypothesis.length<=1200,c.id);
    assert.match(b.hypothesis,/ANSWER: LABEL/);
  }
  const out=scoreBenchmarkCase({
    spec:cases[0],facts,
    singleAnswer:"ANSWER: NO\nCorrect inference.",
    swarmAnswer:"ANSWER: INSUFFICIENT\nIncorrectly withheld.",
    singleTokens:{input:100,output:50},
    swarmTokens:{input:700,output:300}
  });
  assert.equal(out.single.correct,true);
  assert.equal(out.swarm.correct,false);
  assert.ok(out.swarm.illustrativePaidUsd>out.single.illustrativePaidUsd);
});

test("single-agent baseline completes exactly one metered claim and cannot replay",async()=>{
  const {shop,caseId}=await seed();const fake=provider();
  try{
    const result=await executeSingleAgentBenchmark({shop,caseId,provider:fake,env:env(shop)});
    assert.equal(result.status,"completed");
    assert.equal(result.callsAttempted,1);
    assert.equal(result.callsCommitted,1);
    assert.equal(fake.requests.length,1);
    const p=JSON.parse(fake.requests[0]);
    assert.equal(p.verifiedReadOnlyShopifySnapshot.publishedProductsSampled,13);
    assert.deepEqual(p.previousDebate,[]);
    const run=await db.swarmExecution.findUniqueOrThrow({where:{caseId}});
    assert.equal(run.plan,"free_benchmark_single");
    assert.equal(run.callsStarted,1);
    const attempt=await db.swarmInvocation.findFirstOrThrow({where:{shop,executionId:run.id}});
    assert.equal(attempt.status,"committed");
    assert.equal(attempt.inputTokens,102);
    assert.equal((await db.swarmUsageMonth.findFirstOrThrow({where:{shop}})).consumed,1);
    const answer=await db.swarmMessage.findFirstOrThrow({where:{shop,caseId,senderId:BENCHMARK_SENDER}});
    assert.equal(parseBenchmarkAnswer(answer.body),"NO");
    await assert.rejects(executeSingleAgentBenchmark({shop,caseId,provider:fake,env:env(shop)}),
      /not available|cannot be replayed/);
    assert.equal(fake.requests.length,1);
  }finally{await eraseMerchantData(shop)}
  assert.equal(await db.swarmExecution.count({where:{shop}}),0);
  assert.equal(await db.swarmInvocation.count({where:{shop}}),0);
  assert.equal(await db.swarmUsageMonth.count({where:{shop}}),0);
});

test("uncertain model outcome consumes one attempt and never retries baseline",async()=>{
  const {shop,caseId}=await seed();const fake=provider(true);
  try{
    const r=await executeSingleAgentBenchmark({shop,caseId,provider:fake,env:env(shop)});
    assert.equal(r.status,"blocked_uncertain");
    assert.equal(r.callsAttempted,1);
    assert.equal(r.callsCommitted,0);
    assert.equal((await db.swarmUsageMonth.findFirstOrThrow({where:{shop}})).reserved,0);
    assert.equal((await db.swarmUsageMonth.findFirstOrThrow({where:{shop}})).consumed,1);
    const run=await db.swarmExecution.findUniqueOrThrow({where:{caseId}});
    assert.equal(run.errorCode,"BASELINE_OUTPUT_OR_STORAGE_UNCERTAIN");
    const inv=await db.swarmInvocation.findFirstOrThrow({where:{shop,executionId:run.id}});
    assert.equal(inv.status,"uncertain");
    assert.equal(fake.requests.length,1);
  }finally{await eraseMerchantData(shop)}
});

test("shop allowlist, live pilot and missing evidence block before metering",async()=>{
  const {shop,caseId}=await seed();const fake=provider();
  try{
    for(const different of [
      {...env(shop),SWARM_WORKER_ALLOWED_SHOP:"foreign.myshopify.com"},
      {...env(shop),AGENTIC_PILOT_MODE:"read_only"},
      {...env(shop),SWARM_BENCHMARK_ENABLED:"false"}
    ]){
      await assert.rejects(executeSingleAgentBenchmark({shop,caseId,provider:fake,env:different}));
    }
    await db.swarmMessage.deleteMany({where:{shop,caseId,senderId:"shopify-admin-verified-snapshot"}});
    await assert.rejects(executeSingleAgentBenchmark({shop,caseId,provider:fake,env:env(shop)}),
      /Verified Shopify evidence/);
    assert.equal(await db.swarmExecution.count({where:{shop}}),0);
    assert.equal(await db.swarmUsageMonth.count({where:{shop}}),0);
    assert.equal(fake.requests.length,0);
  }finally{await eraseMerchantData(shop)}
});
