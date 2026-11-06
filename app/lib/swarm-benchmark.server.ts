import {createHash,randomUUID} from "node:crypto";
import db from "../db.server";
import {readOnlyPilotEnabled} from "./pilot-readonly";
import {SHOPIFY_EVIDENCE_SENDER,requireVerifiedShopifySnapshot} from "./swarm-evidence.server";
import {buildWorkerPrompt,monthKey,PILOT_LEASE_MS,validateModelUsage,type BoundedModelProvider} from "./swarm-execution-policy";
import {SwarmProviderError} from "./swarm-gemini.server";
import {SWARM_PLANS,SwarmPolicyError} from "./swarm-policy";

/**
 * Exactly one model call, using the same authenticated evidence and model
 * adapter as the six-call swarm. Do not put a secret or merchant product body
 * into the benchmark corpus. This comparison is not a merchant workflow.
 */
const BENCHMARK_SENDER="benchmark-single-agent";
export {BENCHMARK_SENDER};

function authorize(shop:string,env:Record<string,string|undefined>){
  if(readOnlyPilotEnabled(env)||
    env.SWARM_WORKER_ENABLED!=="true"||env.SWARM_EXECUTION_ENABLED!=="true"||
    env.SWARM_BENCHMARK_ENABLED!=="true"||env.SWARM_WORKER_ALLOWED_SHOP!==shop||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)){
    throw new SwarmPolicyError("Benchmark is not enabled for this exact dev merchant.",403);
  }
}

function sanitizeError(e:unknown){
  return e instanceof SwarmProviderError ? e.diagnosticCode : "BASELINE_OUTPUT_OR_STORAGE_UNCERTAIN";
}

export async function executeSingleAgentBenchmark(input:{
  shop:string;caseId:string;provider:BoundedModelProvider;
  env?:Record<string,string|undefined>;
  at?:Date;
}){
  const env=input.env??process.env;
  const now=input.at??new Date();
  authorize(input.shop,env);
  if(!/^[a-z0-9]{12,40}$/.test(input.caseId))throw new SwarmPolicyError("Invalid benchmark case identifier.");
  if(!input.provider.modelName||!input.provider.providerName)throw new SwarmPolicyError("Model identity missing.");
  const evidence=await db.swarmMessage.findFirst({where:{
    shop:input.shop,caseId:input.caseId,senderId:SHOPIFY_EVIDENCE_SENDER,kind:"evidence"
  },select:{body:true}});
  if(!evidence)throw new SwarmPolicyError("Verified Shopify evidence is required before the baseline.",409);
  let snapshot;
  try{snapshot=requireVerifiedShopifySnapshot(JSON.parse(evidence.body),input.shop,now);}
  catch{throw new SwarmPolicyError("Verified evidence is missing or stale.",409);}

  // Reserve the single worst-case model request before invoking the provider.
  const reservation=await db.$transaction(async tx=>{
    const lock=await tx.storeConfig.updateMany({where:{shop:input.shop},data:{updatedAt:new Date()}});
    if(lock.count!==1)throw new SwarmPolicyError("Merchant disconnected.",401);
    if(!(await tx.session.count({where:{shop:input.shop}})))throw new SwarmPolicyError("Shopify installation absent.",401);
    const research=await tx.swarmCase.findFirst({where:{
      id:input.caseId,shop:input.shop,status:"queued",reviewRound:0
    }});
    if(!research)throw new SwarmPolicyError("Benchmark case is not available.",409);
    if(await tx.swarmExecution.findUnique({where:{caseId:input.caseId}}))
      throw new SwarmPolicyError("Benchmark execution cannot be replayed.",409);
    if(await tx.swarmExecution.count({where:{shop:input.shop,status:"running"}}))
      throw new SwarmPolicyError("Another model run is active for this merchant.",429);
    const month=monthKey(now);
    const usage=await tx.swarmUsageMonth.upsert({where:{shop_month:{
      shop:input.shop,month}},create:{shop:input.shop,month},update:{}});
    if(usage.reserved+usage.consumed+1>SWARM_PLANS.free.researchCredits)
      throw new SwarmPolicyError("Benchmark model-request cap exceeded.",403);
    await tx.swarmUsageMonth.update({where:{shop_month:{shop:input.shop,month}},
      data:{reserved:{increment:1}}});
    const token=randomUUID();
    const run=await tx.swarmExecution.create({data:{
      shop:input.shop,caseId:input.caseId,status:"running",
      provider:input.provider.providerName,model:input.provider.modelName,
      plan:"free_benchmark_single",usageMonth:month,maxCalls:1,leaseToken:token,
      leaseExpiresAt:new Date(now.getTime()+PILOT_LEASE_MS)
    }});
    return {case:research,id:run.id,token,month};
  },{timeout:10000});

  let attempted=false;
  try{
    const request=buildWorkerPrompt({
      phase:"independent_hypothesis",title:reservation.case.title,
      hypothesis:reservation.case.hypothesis,metric:reservation.case.metric,
      rejectionRule:reservation.case.rejectionRule,
      specialty:"Generalist Shopify evidence audit; use only facts in the same snapshot as the swarm",
      trustedShopifyFacts:snapshot,prior:[]
    });
    const invocation=await db.$transaction(async tx=>{
      const lock=await tx.storeConfig.updateMany({where:{shop:input.shop},data:{updatedAt:new Date()}});
      if(lock.count!==1)throw new SwarmPolicyError("Merchant disconnected.",401);
      const run=await tx.swarmExecution.findFirst({where:{
        id:reservation.id,shop:input.shop,status:"running",leaseToken:reservation.token
      }});
      if(!run||!run.leaseExpiresAt||run.leaseExpiresAt<=new Date()||
         run.callsStarted!==0||run.callsFinished!==0)throw new SwarmPolicyError("Baseline reservation stale.",409);
      const claim=await tx.swarmInvocation.create({data:{
        shop:input.shop,executionId:run.id,ordinal:0,agentId:BENCHMARK_SENDER,
        phase:"single_agent_control",status:"attempted"
      }});
      await tx.swarmUsageMonth.update({where:{shop_month:{shop:input.shop,month:reservation.month}},
        data:{reserved:{decrement:1},consumed:{increment:1}}});
      await tx.swarmExecution.update({where:{id:run.id},data:{
        callsStarted:1,leaseExpiresAt:new Date(Date.now()+PILOT_LEASE_MS)
      }});
      return claim.id;
    },{timeout:10000});
    attempted=true;
    const answer=await input.provider.generate(request);
    validateModelUsage(answer,input.provider.modelName);
    const hash=createHash("sha256").update(answer.text).digest("hex");
    await db.$transaction(async tx=>{
      const lock=await tx.storeConfig.updateMany({where:{shop:input.shop},data:{updatedAt:new Date()}});
      if(lock.count!==1)throw new SwarmPolicyError("Merchant disconnected.",401);
      const run=await tx.swarmExecution.findFirst({where:{
        shop:input.shop,id:reservation.id,status:"running",leaseToken:reservation.token,
        callsStarted:1,callsFinished:0
      }});
      if(!run)throw new SwarmPolicyError("Baseline commit lost fencing token.",409);
      const updated=await tx.swarmInvocation.updateMany({where:{
        shop:input.shop,id:invocation,executionId:run.id,status:"attempted"
      },data:{status:"committed",inputTokens:answer.inputTokens,
        outputTokens:answer.outputTokens,outputHash:hash}});
      if(updated.count!==1)throw new SwarmPolicyError("Attempt already settled.",409);
      await tx.swarmMessage.create({data:{
        shop:input.shop,caseId:input.caseId,senderId:BENCHMARK_SENDER,
        kind:"hypothesis",body:answer.text,
        evidenceJson:JSON.stringify(answer.evidenceUrls),
        falsifier:answer.falsifier??null,reviewRound:0
      }});
      await tx.swarmCase.update({where:{id:input.caseId},data:{status:"needs_evidence"}});
      await tx.swarmExecution.update({where:{id:run.id},data:{
        status:"completed",callsFinished:1,inputTokens:answer.inputTokens,
        outputTokens:answer.outputTokens,leaseToken:null,leaseExpiresAt:null
      }});
    },{timeout:10000});
    return {status:"completed",caseId:input.caseId,callsAttempted:1,callsCommitted:1,
      inputTokens:answer.inputTokens,outputTokens:answer.outputTokens};
  }catch(e){
    await db.$transaction(async tx=>{
      const lock=await tx.storeConfig.updateMany({where:{shop:input.shop},data:{updatedAt:new Date()}});
      if(lock.count!==1)throw new SwarmPolicyError("Merchant disconnected.",401);
      const run=await tx.swarmExecution.findFirst({where:{
        id:reservation.id,shop:input.shop,status:"running",leaseToken:reservation.token
      }});
      if(!run)throw new SwarmPolicyError("Baseline outcome requires manual reconciliation.",409);
      if(run.callsStarted===0){
        await tx.swarmUsageMonth.update({where:{shop_month:{shop:input.shop,month:reservation.month}},
          data:{reserved:{decrement:1}}});
      }
      await tx.swarmInvocation.updateMany({where:{
        shop:input.shop,executionId:run.id,status:"attempted"
      },data:{status:"uncertain"}});
      await tx.swarmExecution.update({where:{id:run.id},data:{
        status:"blocked_uncertain",errorCode:sanitizeError(e),
        leaseToken:null,leaseExpiresAt:null
      }});
      await tx.swarmCase.updateMany({where:{shop:input.shop,id:input.caseId},
        data:{status:"paused"}});
    },{timeout:10000});
    return {status:"blocked_uncertain",caseId:input.caseId,
      callsAttempted:attempted?1:0,callsCommitted:0,inputTokens:0,outputTokens:0};
  }
}
