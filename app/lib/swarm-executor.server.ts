import {randomUUID,createHash} from "node:crypto";
import db from "../db.server";
import {SwarmProviderError} from "./swarm-gemini.server";
import {readOnlyPilotEnabled} from "./pilot-readonly";
import {recordSwarmWorkerMessage} from "./swarm-roster.server";
import {SWARM_PLANS,SwarmPolicyError} from "./swarm-policy";
import {
  buildWorkerPrompt,monthKey,PILOT_MAX_MODEL_CALLS,PILOT_LEASE_MS,
  planSixCallResearch,validateModelUsage,type BoundedModelProvider,
  type PlannedInvocation,type SwarmAgentIdentity
} from "./swarm-execution-policy";

const IN_PROGRESS=["queued","researching","challenged","needs_evidence"];
const TERMINAL=["awaiting_merchant_review","needs_evidence","rejected"];

function assertOperatorEnabled(shop:string,env:Record<string,string|undefined>){
  if(readOnlyPilotEnabled(env))throw new SwarmPolicyError(
    "The separately installed read-only catalog pilot cannot execute swarms.",403);
  if(env.SWARM_WORKER_ENABLED!=="true"||env.SWARM_EXECUTION_ENABLED!=="true"||
      env.SWARM_WORKER_ALLOWED_SHOP!==shop||
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)){
    throw new SwarmPolicyError("Bounded worker is not enabled for this exact Shopify shop.",403);
  }
}

async function lockShop(tx: any,shop:string){
  const r=await tx.storeConfig.updateMany({where:{shop},data:{updatedAt:new Date()}});
  if(r.count!==1)throw new SwarmPolicyError("Merchant no longer connected.",401);
}
function validId(x:string){return typeof x==="string"&&/^[a-z0-9]{12,40}$/.test(x);}
function ensureCaseId(x:string){if(!validId(x))throw new SwarmPolicyError("Invalid case id.");}

export async function reserveBoundedSwarmCase(input:{
  shop:string;caseId:string;provider:BoundedModelProvider;env?:Record<string,string|undefined>;
  at?:Date;
}){
  const env=input.env??process.env,at=input.at??new Date();
  assertOperatorEnabled(input.shop,env);ensureCaseId(input.caseId);
  if(input.provider.providerName.length>80||input.provider.modelName.length>80||
      !input.provider.providerName||!input.provider.modelName){
    throw new SwarmPolicyError("Invalid provider identity.");
  }
  return db.$transaction(async tx=>{
    await lockShop(tx,input.shop);
    const installed=await tx.session.findFirst({where:{shop:input.shop},select:{id:true}});
    if(!installed)throw new SwarmPolicyError("No current Shopify installation session.",401);
    const existing=await tx.swarmExecution.findUnique({where:{caseId:input.caseId}});
    if(existing)throw new SwarmPolicyError(
      "A research case can have only one execution attempt; do not replay paid calls.",409);
    const occupied=await tx.swarmExecution.count({where:{shop:input.shop,status:"running"}});
    if(occupied)throw new SwarmPolicyError("Another bounded swarm is already running for this merchant.",429);
    const research=await tx.swarmCase.findFirst({where:{id:input.caseId,shop:input.shop,status:"queued"}});
    if(!research||research.reviewRound!==0)throw new SwarmPolicyError(
      "Research case is unavailable, already used, or not queued.",409);
    const participants:unknown=JSON.parse(research.participantsJson);
    if(!Array.isArray(participants)||participants.length!==3||
       participants.some(x=>typeof x!=="string")){
      throw new SwarmPolicyError("Case must have a frozen three-worker pilot roster.",409);
    }
    const agents=await tx.swarmAgent.findMany({where:{
      shop:input.shop,id:{in:participants},role:research.role,status:"active"},
      select:{id:true,role:true,kind:true,status:true,specialty:true}
    });
    if(agents.length!==3||new Set(agents.map(x=>x.id)).size!==3){
      throw new SwarmPolicyError("Some snapshotted workers have retired.",409);
    }
    planSixCallResearch(agents);
    // Launch gate is intentionally free-only. Real paid entitlements cannot
    // be inferred by a CLI switch; they require Partner API reconciliation.
    const month=monthKey(at);
    const usage=await tx.swarmUsageMonth.upsert({where:{shop_month:{
      shop:input.shop,month}},create:{shop:input.shop,month},update:{}});
    if(usage.reserved+usage.consumed+PILOT_MAX_MODEL_CALLS>
       SWARM_PLANS.free.researchCredits){
      throw new SwarmPolicyError("Monthly pilot research credit cap exceeded.",403);
    }
    await tx.swarmUsageMonth.update({where:{shop_month:{shop:input.shop,month}},
      data:{reserved:{increment:PILOT_MAX_MODEL_CALLS}}});
    const leaseToken=randomUUID();
    const run=await tx.swarmExecution.create({data:{
      shop:input.shop,caseId:input.caseId,status:"running",
      provider:input.provider.providerName,model:input.provider.modelName,plan:"free",usageMonth:month,
      maxCalls:PILOT_MAX_MODEL_CALLS,leaseToken,
      leaseExpiresAt:new Date(at.getTime()+PILOT_LEASE_MS)
    }});
    return {id:run.id,caseId:input.caseId,leaseToken,
      month,maxCalls:run.maxCalls,agents:agents as SwarmAgentIdentity[]};
  },{timeout:10000});
}

async function claimStep(params:{
  shop:string;runId:string;leaseToken:string;ordinal:number;worker:PlannedInvocation;month:string;
}){
  const now=new Date();
  return db.$transaction(async tx=>{
    await lockShop(tx,params.shop);
    const run=await tx.swarmExecution.findFirst({where:{
      shop:params.shop,id:params.runId,status:"running",leaseToken:params.leaseToken
    }});
    if(!run||!run.leaseExpiresAt||run.leaseExpiresAt<=now||
       run.callsStarted!==params.ordinal||run.callsFinished!==params.ordinal){
      throw new SwarmPolicyError("Worker lease or stage is stale; do not replay.",409);
    }
    const research=await tx.swarmCase.findFirst({where:{shop:params.shop,id:run.caseId}});
    if(!research||!IN_PROGRESS.includes(research.status)){
      throw new SwarmPolicyError("Case paused or completed; no new model requests.",409);
    }
    const usage=await tx.swarmUsageMonth.findUnique({where:{shop_month:{
      shop:params.shop,month:params.month
    }}});
    if(!usage||usage.reserved<1)throw new SwarmPolicyError("Prepaid model-call reservation missing.",409);
    // Before network: consume the credit once. A timeout or broken process
    // may have billed; therefore no automatic refund or retry of this step.
    const invocation=await tx.swarmInvocation.create({data:{
      shop:params.shop,executionId:params.runId,ordinal:params.ordinal,
      agentId:params.worker.agentId,phase:params.worker.phase,status:"attempted"
    }});
    await tx.swarmUsageMonth.update({where:{shop_month:{shop:params.shop,month:params.month}},
      data:{reserved:{decrement:1},consumed:{increment:1}}});
    await tx.swarmExecution.update({where:{id:run.id},data:{
      callsStarted:{increment:1},leaseExpiresAt:new Date(now.getTime()+PILOT_LEASE_MS)
    }});
    return {invocationId:invocation.id,caseId:run.caseId};
  },{timeout:10000});
}

async function commitStep(params:{
  shop:string;runId:string;leaseToken:string;invocationId:string;
  inputTokens:number;outputTokens:number;outputText:string;
}){
  const hash=createHash("sha256").update(params.outputText).digest("hex");
  return db.$transaction(async tx=>{
    await lockShop(tx,params.shop);
    const run=await tx.swarmExecution.findFirst({where:{
      id:params.runId,shop:params.shop,status:"running",leaseToken:params.leaseToken
    }});
    if(!run||run.callsFinished!==run.callsStarted-1){
      throw new SwarmPolicyError("Execution receipt is not claimable.",409);
    }
    const claimed=await tx.swarmInvocation.updateMany({where:{
      id:params.invocationId,shop:params.shop,executionId:run.id,status:"attempted"
    },data:{status:"committed",inputTokens:params.inputTokens,
      outputTokens:params.outputTokens,outputHash:hash}});
    if(claimed.count!==1)throw new SwarmPolicyError("Invocation already reconciled.",409);
    return tx.swarmExecution.update({where:{id:run.id},data:{
      callsFinished:{increment:1},inputTokens:{increment:params.inputTokens},
      outputTokens:{increment:params.outputTokens}
    }});
  },{timeout:10000});
}

async function settleRun(params:{
  shop:string;runId:string;leaseToken:string;month:string;
  failed:boolean;requireExpiredAt?:Date;diagnosticCode?:string;
}){
  return db.$transaction(async tx=>{
    await lockShop(tx,params.shop);
    const run=await tx.swarmExecution.findFirst({where:{
      id:params.runId,shop:params.shop,status:"running",leaseToken:params.leaseToken
    }});
    if(!run)throw new SwarmPolicyError("Run has already been settled.",409);
    if(params.requireExpiredAt&&(!run.leaseExpiresAt||run.leaseExpiresAt>params.requireExpiredAt)){
      throw new SwarmPolicyError("Run lease was refreshed before reconciliation.",409);
    }
    const remaining=run.maxCalls-run.callsStarted;
    if(remaining<0)throw new SwarmPolicyError("Swarm used more than the fixed budget.",409);
    if(remaining){
      await tx.swarmUsageMonth.update({where:{shop_month:{shop:params.shop,month:params.month}},
        data:{reserved:{decrement:remaining}}});
    }
    const research=await tx.swarmCase.findFirst({where:{shop:params.shop,id:run.caseId}});
    const success=!params.failed&&run.callsStarted===PILOT_MAX_MODEL_CALLS&&
      run.callsFinished===run.callsStarted&&
      !!research&&TERMINAL.includes(research.status);
    const status=success?"completed":"blocked_uncertain";
    if(!success&&research&&IN_PROGRESS.includes(research.status)){
      await tx.swarmCase.updateMany({where:{id:research.id,shop:params.shop},
        data:{status:"paused"}});
    }
    await tx.swarmInvocation.updateMany({where:{
      shop:params.shop,executionId:run.id,status:"attempted"
    },data:{status:"uncertain"}});
    const saved=await tx.swarmExecution.update({where:{id:run.id},data:{
      status,errorCode:success?null:(params.diagnosticCode??"OUTCOME_UNCERTAIN_RECONCILE_MANUALLY"),
      leaseToken:null,leaseExpiresAt:null
    }});
    return {id:saved.id,status:saved.status,callsAttempted:saved.callsStarted,
      callsCommitted:saved.callsFinished,inputTokens:saved.inputTokens,
      outputTokens:saved.outputTokens,caseStatus:research?.status??"missing"};
  },{timeout:10000});
}

/**
 * Local, owner-operated execution. No HTTP route or cron trigger is exposed.
 * Each invocation is claimed + charged BEFORE model POST, and never retried
 * automatically. If process dies, an expired lease is reconciled manually.
 */
export async function executeBoundedSwarmCase(input:{
  shop:string;caseId:string;provider:BoundedModelProvider;
  env?:Record<string,string|undefined>;
}){
  const env=input.env??process.env;
  const reserved=await reserveBoundedSwarmCase({...input,env});
  const planned=planSixCallResearch(reserved.agents);
  const participant=new Map(reserved.agents.map(a=>[a.id,a]));
  let failed=false;
  let diagnosticCode:string|undefined;
  for(const stage of planned){
    try{
      const research=await db.swarmCase.findFirst({where:{
        id:reserved.caseId,shop:input.shop
      }});
      if(!research)throw new SwarmPolicyError("Case missing.");
      const prior=await db.swarmMessage.findMany({
        where:{shop:input.shop,caseId:reserved.caseId,senderId:{not:"merchant"}},
        select:{senderId:true,kind:true,body:true},orderBy:{createdAt:"asc"},take:20
      });
      const agent=participant.get(stage.agentId);
      if(!agent)throw new SwarmPolicyError("Unknown case worker.");
      const prompt=buildWorkerPrompt({
        phase:stage.phase,title:research.title,hypothesis:research.hypothesis,
        metric:research.metric,rejectionRule:research.rejectionRule,
        specialty:agent.specialty,prior
      });
      const claimed=await claimStep({shop:input.shop,runId:reserved.id,
        leaseToken:reserved.leaseToken,month:reserved.month,ordinal:stage.ordinal,worker:stage});
      const modelOutput=await input.provider.generate(prompt); // Only network side effect.
      validateModelUsage(modelOutput,input.provider.modelName);
      const verdict=stage.kind==="verdict" ?
        (modelOutput.verdict==="rejected"?"rejected":"abstain"):undefined;
      await recordSwarmWorkerMessage({
        shop:input.shop,caseId:reserved.caseId,senderId:stage.agentId,
        kind:stage.kind,body:modelOutput.text,evidenceUrls:modelOutput.evidenceUrls,
        falsifier:modelOutput.falsifier,
        verdict
      },env);
      await commitStep({shop:input.shop,runId:reserved.id,
        leaseToken:reserved.leaseToken,invocationId:claimed.invocationId,
        inputTokens:modelOutput.inputTokens,outputTokens:modelOutput.outputTokens,
        outputText:modelOutput.text});
    }catch(error){
      // Never persist raw provider data, prompts, messages or secrets.
      // Distinguish HTTP, truncation and transport failures for later tests.
      diagnosticCode=error instanceof SwarmProviderError ? error.diagnosticCode :
        "WORKER_OUTPUT_OR_PERSISTENCE_FAILURE";
      failed=true;break;
    }
  }
  return settleRun({shop:input.shop,runId:reserved.id,leaseToken:reserved.leaseToken,
    month:reserved.month,failed,diagnosticCode});
}

/** Explicit reconciliation only: never resumes uncertain provider calls. */
export async function closeExpiredSwarmRun(input:{
  shop:string;runId:string;env?:Record<string,string|undefined>;at?:Date;
}){
  const env=input.env??process.env,now=input.at??new Date();
  assertOperatorEnabled(input.shop,env);
  const run=await db.swarmExecution.findFirst({where:{
    shop:input.shop,id:input.runId,status:"running"
  }});
  if(!run||!run.leaseExpiresAt||run.leaseExpiresAt>now){
    throw new SwarmPolicyError("Worker lease is not abandoned.",409);
  }
  return settleRun({shop:input.shop,runId:run.id,leaseToken:run.leaseToken!,
    month:run.usageMonth,failed:true,requireExpiredAt:now});
}
