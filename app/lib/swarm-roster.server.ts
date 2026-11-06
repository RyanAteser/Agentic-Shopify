import db from "../db.server";
import { AGENTS } from "./agent-registry";
import {
  assertAgentMessage, calculateSwarmRoster, mayResizeRole, requiredSkeptics,
  requireSwarmRole, validateResearchBrief, SWARM_PLANS, SwarmPolicyError,
  type SwarmPlan, type SwarmMessageKind, type SwarmAgentKind,
} from "./swarm-policy";

/** Lock Session -> StoreConfig -> team, matching uninstall/redaction ordering. */
async function lockMerchant(tx: any, shop: string, sessionId: string) {
  const session=await tx.session.updateMany({where:{id:sessionId,shop},data:{id:sessionId}});
  if(session.count!==1)throw new SwarmPolicyError("Shopify session is no longer active.",401);
  const store=await tx.storeConfig.updateMany({where:{shop},data:{updatedAt:new Date()}});
  if(store.count!==1)throw new SwarmPolicyError("Merchant is disconnected.",401);
}

export async function loadSwarmTeam(shop: string) {
  const [agents,cases]=await Promise.all([
    db.swarmAgent.findMany({where:{shop,status:"active"},
      select:{id:true,role:true,kind:true,label:true,status:true},
      orderBy:[{createdAt:"asc"},{id:"asc"}],take:70}),
    db.swarmCase.findMany({where:{shop},
      select:{id:true,role:true,title:true,metric:true,rejectionRule:true,status:true,reviewRound:true,createdAt:true},
      orderBy:{createdAt:"desc"},take:12})
  ]);
  const participants=calculateSwarmRoster(agents as Array<{role:string;kind:SwarmAgentKind;status:string}>);
  const messages=cases.length ? await db.swarmMessage.findMany({
    where:{shop,caseId:{in:cases.map(x=>x.id)}},
    select:{id:true,caseId:true,senderId:true,recipientId:true,kind:true,body:true,verdict:true,createdAt:true},
    orderBy:{createdAt:"desc"},take:80
  }) : [];
  return {agents,cases,participants,messages};
}

export async function resizeSwarmRole(params:{
  shop:string;sessionId:string;role:string;desired:number;plan:SwarmPlan;
}) {
  const role=requireSwarmRole(params.role);
  const roleName=AGENTS.find(x=>x.id===role)!.name;
  if(!Object.hasOwn(SWARM_PLANS,params.plan))throw new SwarmPolicyError("Unverified plan.",403);
  return db.$transaction(async tx=>{
    await lockMerchant(tx,params.shop,params.sessionId);
    const active=await tx.swarmAgent.findMany({where:{shop:params.shop,status:"active"},
      orderBy:[{createdAt:"asc"},{id:"asc"}]});
    const state=calculateSwarmRoster(active as Array<{role:string;kind:SwarmAgentKind;status:string}>);
    const currentRole=state.roles[role]?.specialists??0;
    const bounds=mayResizeRole({currentTotal:state.totalSpecialists,currentRole,
      requested:params.desired,plan:params.plan});
    const specialists=active.filter(x=>x.role===role&&x.kind==="specialist");
    const skeptics=active.filter(x=>x.role===role&&x.kind==="skeptic");
    if(params.desired<specialists.length){
      await tx.swarmAgent.updateMany({where:{shop:params.shop,
        id:{in:specialists.slice(params.desired).map(x=>x.id)},status:"active"},
        data:{status:"retired"}});
    }else if(params.desired>specialists.length){
      const count=await tx.swarmAgent.count({where:{shop:params.shop,role,kind:"specialist"}});
      await tx.swarmAgent.createMany({data:Array.from({length:params.desired-specialists.length},(_,i)=>({
        shop:params.shop,role,kind:"specialist",status:"active",
        label:roleName+" #"+(count+i+1)
      }))});
    }
    if(bounds.skeptics<skeptics.length){
      await tx.swarmAgent.updateMany({where:{shop:params.shop,
        id:{in:skeptics.slice(bounds.skeptics).map(x=>x.id)},status:"active"},
        data:{status:"retired"}});
    }else if(bounds.skeptics>skeptics.length){
      const count=await tx.swarmAgent.count({where:{shop:params.shop,role,kind:"skeptic"}});
      await tx.swarmAgent.createMany({data:Array.from({length:bounds.skeptics-skeptics.length},(_,i)=>({
        shop:params.shop,role,kind:"skeptic",status:"active",
        label:roleName+" Skeptic #"+(count+i+1)
      }))});
    }
    if(params.desired!==currentRole){
      // Invalidate assigned researcher snapshots when the roster changes.
      await tx.swarmCase.updateMany({where:{shop:params.shop,role,
        status:{in:["queued","researching","challenged","needs_evidence"]}},
        data:{status:"paused"}});
    }
    return {specialists:params.desired,skeptics:requiredSkeptics(params.desired),
      totalSpecialists:bounds.nextTotal,plan:params.plan};
  },{timeout:10000});
}

export async function queueSwarmResearch(params:{
  shop:string;sessionId:string;role:string;title:unknown;hypothesis:unknown;
  metric:unknown;rejectionRule:unknown;plan:SwarmPlan;
}) {
  const role=requireSwarmRole(params.role);
  const brief=validateResearchBrief(params);
  return db.$transaction(async tx=>{
    await lockMerchant(tx,params.shop,params.sessionId);
    const active=await tx.swarmAgent.findMany({where:{shop:params.shop,status:"active",role},
      select:{id:true,kind:true}});
    const all=await tx.swarmAgent.findMany({where:{shop:params.shop,status:"active"},
      select:{role:true,kind:true,status:true}});
    const roster=calculateSwarmRoster(all as Array<{role:string;kind:SwarmAgentKind;status:string}>);
    if(roster.totalSpecialists>SWARM_PLANS[params.plan].specialistSlots){
      throw new SwarmPolicyError("Reduce specialists to your verified plan before creating work.",403);
    }
    const n=active.filter(x=>x.kind==="specialist").length;
    const skeptical=active.filter(x=>x.kind==="skeptic").length;
    if(n<1||skeptical!==requiredSkeptics(n)){
      throw new SwarmPolicyError("Role requires specialists and complete skeptic coverage.",409);
    }
    const open=await tx.swarmCase.count({where:{shop:params.shop,
      status:{in:["queued","researching","challenged","needs_evidence"]}}});
    if(open>=3)throw new SwarmPolicyError("Three research cases are already queued.",429);
    const item=await tx.swarmCase.create({data:{
      shop:params.shop,role,...brief,status:"queued",
      participantsJson:JSON.stringify(active.map(x=>x.id))
    }});
    const body=JSON.stringify({
      hypothesis:brief.hypothesis,successMetric:brief.metric,rejectionRule:brief.rejectionRule,
      instruction:"Independently test assumptions, cite sources and counterexamples. No Shopify writes."
    });
    await tx.swarmMessage.createMany({data:active.map(x=>({
      shop:params.shop,caseId:item.id,senderId:"merchant",recipientId:x.id,
      kind:"brief",body,evidenceJson:"[]",falsifier:brief.rejectionRule
    }))});
    // Queue only. No model credentials or paid calls are invoked.
    return {id:item.id,recipients:active.length,status:"queued" as const};
  },{timeout:10000});
}

/**
 * Trusted future worker transport. Do not expose as an HTTP endpoint without
 * capability authentication, credit reservation and idempotency.
 * Every claim is attributed; skepticism cannot be bypassed by specialists.
 */
export async function recordSwarmWorkerMessage(input:{
  shop:string;caseId:string;senderId:string;recipientId?:string;
  kind:SwarmMessageKind;body:string;evidenceUrls:string[];
  falsifier?:string;verdict?:"supported"|"rejected"|"abstain";
},env:Record<string,string|undefined>=process.env){
  if(env.SWARM_EXECUTION_ENABLED!=="true"){
    throw new SwarmPolicyError("Swarm model execution is disabled.",403);
  }
  return db.$transaction(async tx=>{
    const valid=await tx.storeConfig.updateMany({where:{shop:input.shop},
      data:{updatedAt:new Date()}});
    if(valid.count!==1)throw new SwarmPolicyError("Merchant no longer connected.",401);
    const item=await tx.swarmCase.findFirst({where:{shop:input.shop,id:input.caseId}});
    if(!item||!["queued","researching","challenged","needs_evidence"].includes(item.status)){
      throw new SwarmPolicyError("Research case not active for this merchant.",409);
    }
    const sender=await tx.swarmAgent.findFirst({
      where:{shop:input.shop,id:input.senderId,status:"active"}});
    if(!sender)throw new SwarmPolicyError("Agent not authorized for merchant.",403);
    const parsedParticipants:unknown=JSON.parse(item.participantsJson);
    const initial:string[]=Array.isArray(parsedParticipants) &&
      parsedParticipants.every(x=>typeof x==="string") ? parsedParticipants : [];
    if(!Array.isArray(initial)||!initial.includes(sender.id)){
      const replyInvite=await tx.swarmMessage.count({where:{shop:input.shop,
        caseId:input.caseId,recipientId:sender.id}});
      if(!replyInvite)throw new SwarmPolicyError("Agent has not joined this research case.",403);
    }
    if(input.recipientId){
      const recipient=await tx.swarmAgent.findFirst({where:{
        shop:input.shop,id:input.recipientId,status:"active"}});
      if(!recipient)throw new SwarmPolicyError("Cross-merchant or inactive recipient.",403);
    }
    assertAgentMessage({kind:input.kind,actorKind:sender.kind as SwarmAgentKind,
      content:input.body,evidenceUrls:input.evidenceUrls,falsifier:input.falsifier});
    const reviewRound=item.reviewRound+(input.kind==="revision"?1:0);
    if(input.kind==="hypothesis"&&item.status!=="queued"){
      throw new SwarmPolicyError("A later claim must be a revision, not a fresh initial hypothesis.",409);
    }
    if(input.kind==="revision"&&!["challenged","needs_evidence"].includes(item.status)){
      throw new SwarmPolicyError("Revisions require a previous challenge or evidence gap.",409);
    }
    if(input.kind==="verdict"){
      if(!initial.includes(sender.id)){
        throw new SwarmPolicyError("Only original assigned skeptics may sign a verdict.",403);
      }
      if(sender.role!==item.role||!input.verdict||
         !["supported","rejected","abstain"].includes(input.verdict)){
        throw new SwarmPolicyError("Only assigned role skeptics can sign verdicts.",403);
      }
      const challenged=await tx.swarmMessage.count({where:{shop:input.shop,
        caseId:input.caseId,senderId:sender.id,kind:"challenge",reviewRound}});
      if(!challenged)throw new SwarmPolicyError("Skeptic must challenge before signing.",409);
    }else if(input.verdict)throw new SwarmPolicyError("Only verdict messages may include a decision.");
    const message=await tx.swarmMessage.create({data:{
      shop:input.shop,caseId:input.caseId,senderId:sender.id,
      recipientId:input.recipientId??null,kind:input.kind,body:input.body,
      evidenceJson:JSON.stringify(input.evidenceUrls),falsifier:input.falsifier??null,
      verdict:input.verdict??null,reviewRound
    }});
    let status="researching";
    if(input.kind==="challenge")status="challenged";
    if(input.kind==="verdict"){
      const reviewerIds=(await tx.swarmAgent.findMany({where:{shop:input.shop,
        role:item.role,kind:"skeptic",id:{in:initial as string[]}},
        select:{id:true}})).map(x=>x.id);
      const verdicts=await tx.swarmMessage.findMany({
        where:{shop:input.shop,caseId:input.caseId,kind:"verdict",
          senderId:{in:reviewerIds},reviewRound},orderBy:[{createdAt:"desc"},{id:"desc"}],
        select:{senderId:true,verdict:true}});
      const latest=new Map<string,string|null>();
      for(const v of verdicts)if(!latest.has(v.senderId))latest.set(v.senderId,v.verdict);
      if([...latest.values()].includes("rejected"))status="rejected";
      else if(reviewerIds.length&&reviewerIds.every(id=>latest.get(id)==="supported")){
        status="awaiting_merchant_review";
      }else status="needs_evidence";
    }
    await tx.swarmCase.updateMany({where:{shop:input.shop,id:input.caseId},
      data:{status,reviewRound}});
    return {id:message.id,status};
  },{timeout:10000});
}
