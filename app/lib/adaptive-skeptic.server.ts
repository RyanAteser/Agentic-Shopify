import db from "../db.server";
import {SwarmPolicyError} from "./swarm-policy";
import {SwarmProviderError} from "./swarm-gemini.server";
import {
  ADAPTIVE_GATE_SENDER,claimStep,commitStep,
  reserveBoundedSwarmCase,settleRun
} from "./swarm-executor.server";
import {SHOPIFY_EVIDENCE_SENDER,requireVerifiedShopifySnapshot} from "./swarm-evidence.server";
import {routeAdaptiveSkeptic,type AdaptiveRoutingDecision} from "./adaptive-skeptic-policy";
import {buildWorkerPrompt,planSixCallResearch,validateModelUsage,
  type BoundedModelProvider,type BoundedModelRequest,type SwarmPhase} from "./swarm-execution-policy";
import {recordSwarmWorkerMessage} from "./swarm-roster.server";

function failReason(error:unknown,stage:number){
  if(error instanceof SwarmProviderError)return error.diagnosticCode;
  if(error instanceof SwarmPolicyError)return "ADAPTIVE_POLICY_STAGE_"+stage;
  return "ADAPTIVE_UNCERTAIN_STAGE_"+stage;
}

/**
 * One bounded execution: 1 grounded specialist call, then 0 or 2 skeptic
 * calls depending only on a versioned deterministic evidence-risk gate.
 * This does NOT imply merchant acceptance, SEO efficacy, or real citations.
 */
export async function executeAdaptiveSkepticCase(input:{
  shop:string;caseId:string;provider:BoundedModelProvider;
  env?:Record<string,string|undefined>;
}){
  const env=input.env??process.env;
  if(env.SWARM_ADAPTIVE_ENABLED!=="true"||
    env.SWARM_EXECUTION_ENABLED!=="true"||
    env.SWARM_WORKER_ENABLED!=="true"||
    env.SWARM_WORKER_ALLOWED_SHOP!==input.shop){
    throw new SwarmPolicyError("Adaptive execution is disabled.",403);
  }
  const verified=await db.swarmMessage.findFirst({where:{
    shop:input.shop,caseId:input.caseId,kind:"evidence",senderId:SHOPIFY_EVIDENCE_SENDER
  },select:{body:true}});
  if(!verified)throw new SwarmPolicyError("Same-shop authenticated evidence is required.",409);
  let facts;
  try{facts=requireVerifiedShopifySnapshot(JSON.parse(verified.body),input.shop);}
  catch{throw new SwarmPolicyError("Authenticated Shopify snapshot is invalid or stale.",409);}

  const reserved=await reserveBoundedSwarmCase({...input,env,mode:"adaptive"});
  const planned=planSixCallResearch(reserved.agents);
  const specialist=reserved.agents.find(x=>x.id===planned[0].agentId);
  const skeptic=reserved.agents.find(x=>x.kind==="skeptic");
  if(!specialist||!skeptic)throw new SwarmPolicyError("Frozen research team missing.",409);
  const initial=await db.swarmCase.findFirst({where:{
    shop:input.shop,id:reserved.caseId
  }});
  if(!initial)throw new SwarmPolicyError("Research case missing after reservation.",409);
  let failed=false,diagnosticCode:string|undefined,stage=0;
  let decision:AdaptiveRoutingDecision|null=null;
  const generation=async(phase:SwarmPhase,ordinal:number,agentId:string,
    kind:"hypothesis"|"challenge"|"verdict",specialty:string)=>{
    stage=ordinal;
    const previous=ordinal===0?[]:await db.swarmMessage.findMany({where:{
      shop:input.shop,caseId:reserved.caseId,
      senderId:{in:[specialist.id,skeptic.id]}
    },select:{senderId:true,body:true,kind:true},orderBy:[{createdAt:"asc"},{id:"asc"}],take:8});
    const prompt=buildWorkerPrompt({
      phase,title:initial.title,hypothesis:initial.hypothesis,
      metric:initial.metric,rejectionRule:initial.rejectionRule,
      trustedShopifyFacts:facts,specialty,
      prior:previous
    });
    const structured:BoundedModelRequest={
      ...prompt,
      system:prompt.system+" Return the JSON text field beginning with an exact first line ANSWER: YES, ANSWER: NO, or ANSWER: INSUFFICIENT. Never make a merchant change. Unverified positive claims require abstention.",
      prompt:decision&&ordinal>0 ?
        JSON.stringify({
          basePrompt:JSON.parse(prompt.prompt),
          deterministicReviewReasons:decision.reasons,
          instruction:"Try to falsify the initial answer using the supplied verified facts. Do not fabricate external evidence or cite nonexistent observations."
        }):prompt.prompt
    };
    if(structured.prompt.length>9500)throw new SwarmPolicyError("Adaptive worker context exceeds input cap.",413);
    const claimed=await claimStep({shop:input.shop,runId:reserved.id,
      leaseToken:reserved.leaseToken,month:reserved.month,ordinal,
      worker:{ordinal,agentId,phase,kind}});
    const result=await input.provider.generate(structured);
    validateModelUsage(result,input.provider.modelName);
    // No auto-approval exists: an externally unverified 'supported' verdict
    // must abstain regardless of what Gemini calls it.
    const verdict=kind==="verdict"?"abstain":undefined;
    await recordSwarmWorkerMessage({
      shop:input.shop,caseId:reserved.caseId,senderId:agentId,
      kind,body:result.text,evidenceUrls:result.evidenceUrls,
      falsifier:result.falsifier,verdict
    },env);
    await commitStep({
      shop:input.shop,runId:reserved.id,leaseToken:reserved.leaseToken,
      invocationId:claimed.invocationId,inputTokens:result.inputTokens,
      outputTokens:result.outputTokens,outputText:result.text
    });
    return result;
  };

  try{
    const first=await generation("independent_hypothesis",0,specialist.id,
      "hypothesis",specialist.specialty);
    decision=routeAdaptiveSkeptic({
      title:initial.title,hypothesis:initial.hypothesis,
      metric:initial.metric,rejectionRule:initial.rejectionRule,
      snapshot:facts,answer:first
    });
    // Immutable trusted router record: only versioned policy codes and
    // model answer label, not freeform model reflections.
    await db.$transaction(async tx=>{
      const lock=await tx.storeConfig.updateMany({
        where:{shop:input.shop},data:{updatedAt:new Date()}
      });
      if(lock.count!==1)throw new SwarmPolicyError("Merchant disconnected.",401);
      const run=await tx.swarmExecution.findFirst({where:{
        shop:input.shop,id:reserved.id,status:"running",
        leaseToken:reserved.leaseToken,callsStarted:1,callsFinished:1
      }});
      if(!run)throw new SwarmPolicyError("Routing gate has stale execution.",409);
      await tx.swarmMessage.create({data:{
        shop:input.shop,caseId:reserved.caseId,senderId:ADAPTIVE_GATE_SENDER,
        kind:"evidence",body:JSON.stringify(decision),evidenceJson:"[]",reviewRound:0
      }});
      if(!decision!.escalate){
        await tx.swarmCase.updateMany({where:{
          shop:input.shop,id:reserved.caseId,status:"researching"
        },data:{status:"needs_evidence"}});
      }
    },{timeout:10000});
    if(decision.escalate){
      await generation("skeptic_challenge",1,skeptic.id,"challenge",skeptic.specialty);
      await generation("skeptic_verdict",2,skeptic.id,"verdict",skeptic.specialty);
    }
  }catch(error){
    diagnosticCode=failReason(error,stage);
    failed=true;
  }
  const settled=await settleRun({
    shop:input.shop,runId:reserved.id,leaseToken:reserved.leaseToken,
    month:reserved.month,failed,diagnosticCode
  });
  return {
    ...settled,
    path:decision?.escalate?"specialist_then_skeptic":"single_grounded_specialist",
    reasons:decision?.reasons??[],
    decisionRecorded:!!decision,
    resultIsApproved:false,
    attemptedCallCeiling:3,
    merchantWritesPerformed:0
  };
}
