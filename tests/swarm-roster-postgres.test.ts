import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";
import {
  loadSwarmTeam,resizeSwarmRole,queueSwarmResearch,recordSwarmWorkerMessage
} from "../app/lib/swarm-roster.server";

const postgres=!!process.env.DATABASE_URL;
const shopName=()=>("swarm-"+randomUUID()+".myshopify.com");
async function installed(shop:string){
  const sessionId="swarm-session-"+randomUUID();
  await db.storeConfig.create({data:{shop}});
  await db.session.create({data:{id:sessionId,shop,state:"installed",isOnline:false,
    scope:"read_products",accessToken:"test-only-offline-token"}});
  return sessionId;
}
const brief={
  role:"seo",title:"Test long-tail search demand",
  hypothesis:"There may be neglected informational searches for this category.",
  metric:"Compare organic nonbrand clicks against matched control products.",
  rejectionRule:"Reject if the adjusted confidence interval does not exclude zero."
};

test("PostgreSQL concurrent agent allocations cannot exceed the verified plan",{
  skip:!postgres,
},async()=>{
  const shop=shopName(),sessionId=await installed(shop);
  try{
    const results=await Promise.allSettled([
      resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"}),
      resizeSwarmRole({shop,sessionId,role:"content",desired:2,plan:"free"}),
    ]);
    assert.equal(results.filter(x=>x.status==="fulfilled").length,1,
      "session row lock must serialize per-shop quotas");
    const team=await loadSwarmTeam(shop);
    assert.equal(team.participants.totalSpecialists,2);
    assert.equal(team.participants.totalSkeptics,1);
    const winningRole=results[0].status==="fulfilled"?"seo":"content";
    const q=await queueSwarmResearch({shop,sessionId,...brief,role:winningRole,plan:"free"});
    assert.equal(q.status,"queued");
    assert.equal(q.recipients,3);
    const messages=await db.swarmMessage.findMany({where:{shop,caseId:q.id}});
    assert.equal(messages.length,3);
    assert.ok(messages.every(m=>m.senderId==="merchant"&&m.kind==="brief"));
    assert.equal(await db.storeActivity.count({where:{shop}}),0);
  }finally{await eraseMerchantData(shop)}
});

test("PostgreSQL agent roles are tenant-isolated, redacted, and suspend stale cases",{
  skip:!postgres,
},async()=>{
  const shop=shopName(),other=shopName();
  const sessionId=await installed(shop);
  const otherSession=await installed(other);
  try{
    await resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"});
    await resizeSwarmRole({shop:other,sessionId:otherSession,role:"content",desired:1,plan:"free"});
    await assert.rejects(resizeSwarmRole({
      shop,sessionId:otherSession,role:"seo",desired:1,plan:"free"
    }),/session/);
    await assert.rejects(queueSwarmResearch({shop,sessionId:otherSession,...brief,plan:"free"}),/session/);
    const q=await queueSwarmResearch({shop,sessionId,...brief,plan:"free"});
    await assert.rejects(recordSwarmWorkerMessage({
      shop,caseId:q.id,senderId:"fake",kind:"hypothesis",
      body:"Test claim that should be denied.",evidenceUrls:["https://example.org/study"],
      falsifier:"Reject if not reproduced"
    }),/disabled/);
    await resizeSwarmRole({shop,sessionId,role:"seo",desired:1,plan:"free"});
    const item=await db.swarmCase.findUniqueOrThrow({where:{id:q.id}});
    assert.equal(item.status,"paused");
    assert.equal((await loadSwarmTeam(shop)).participants.totalSkeptics,1);
    await eraseMerchantData(shop);
    assert.equal(await db.swarmAgent.count({where:{shop}}),0);
    assert.equal(await db.swarmCase.count({where:{shop}}),0);
    assert.equal(await db.swarmMessage.count({where:{shop}}),0);
    assert.equal((await loadSwarmTeam(other)).participants.totalSpecialists,1);
  }finally{
    await eraseMerchantData(shop);
    await eraseMerchantData(other);
  }
});

test("PostgreSQL worker message protocol requires real skeptics and evidence",{
  skip:!postgres,
},async()=>{
  const shop=shopName(),sessionId=await installed(shop);
  try{
    await resizeSwarmRole({shop,sessionId,role:"seo",desired:1,plan:"free"});
    const job=await queueSwarmResearch({shop,sessionId,...brief,plan:"free"});
    const team=await loadSwarmTeam(shop);
    const specialist=team.agents.find(x=>x.kind==="specialist")!;
    const skeptic=team.agents.find(x=>x.kind==="skeptic")!;
    const enabled={SWARM_EXECUTION_ENABLED:"true"};
    const body="Evidence indicates the hypothesis is testable against a neutral control.";
    const source=["https://example.org/independent-analysis"];
    await assert.rejects(recordSwarmWorkerMessage({
      shop,caseId:job.id,senderId:skeptic.id,kind:"verdict",
      body:"Ready to sign without ever challenging.",evidenceUrls:source,
      falsifier:"Reject if no held-out uplift",verdict:"supported"
    },enabled),/challenge/);
    await assert.rejects(recordSwarmWorkerMessage({
      shop,caseId:job.id,senderId:specialist.id,kind:"verdict",
      body:"I would like to approve my own claim.",evidenceUrls:source,
      falsifier:"Reject if no held-out uplift",verdict:"supported"
    },enabled),/Specialists/);
    await recordSwarmWorkerMessage({shop,caseId:job.id,senderId:specialist.id,
      recipientId:skeptic.id,kind:"hypothesis",body,evidenceUrls:source,
      falsifier:"Reject if no held-out uplift"},enabled);
    await recordSwarmWorkerMessage({shop,caseId:job.id,senderId:skeptic.id,
      recipientId:specialist.id,kind:"challenge",
      body:"Alternative explanation: selection bias in chosen products.",evidenceUrls:source},enabled);
    const v=await recordSwarmWorkerMessage({shop,caseId:job.id,senderId:skeptic.id,
      kind:"verdict",body:"I reviewed competing explanations and bounded evidence.",
      evidenceUrls:source,falsifier:"Reject if no held-out uplift",
      verdict:"supported"},enabled);
    assert.equal(v.status,"awaiting_merchant_review");
    await assert.rejects(recordSwarmWorkerMessage({shop,caseId:job.id,
      senderId:specialist.id,kind:"revision",body,evidenceUrls:source,
      falsifier:"Reject if no held-out uplift"},enabled),/not active/);
  }finally{await eraseMerchantData(shop)}
});
