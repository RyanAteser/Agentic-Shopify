import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";
import {
  loadSwarmTeam,resizeSwarmRole,queueSwarmResearch,recordSwarmWorkerMessage
} from "../app/lib/swarm-roster.server";

test("durable swarm roster, skeptic challenge and revision invalidate stale verdicts",async()=>{
  const shop="test-swarm-"+randomUUID()+".myshopify.com";
  const sessionId="swarm-session-"+randomUUID();
  await db.storeConfig.create({data:{shop}});
  await db.session.create({data:{id:sessionId,shop,state:"offline",isOnline:false,
    accessToken:"test-only",scope:"read_products"}});
  try{
    const init=await resizeSwarmRole({shop,sessionId,role:"seo",desired:2,plan:"free"});
    assert.equal(init.skeptics,1);
    const team=await loadSwarmTeam(shop);
    assert.equal(team.participants.totalSpecialists,2);
    assert.equal(team.participants.totalSkeptics,1);
    const researcher=team.agents.find(x=>x.kind==="specialist")!;
    const skeptic=team.agents.find(x=>x.kind==="skeptic")!;
    const brief={
      shop,sessionId,plan:"free" as const,role:"seo",
      title:"Evidence for underserved product queries",
      hypothesis:"Organic demand for specific product questions is unmet by current catalog copy.",
      metric:"Compare nonbrand organic clicks against comparable unchanged products.",
      rejectionRule:"Reject if the held-out confidence interval crosses zero."
    };
    const item=await queueSwarmResearch(brief);
    assert.equal(item.recipients,3);
    const stored=await db.swarmCase.findUniqueOrThrow({where:{id:item.id}});
    assert.equal(stored.reviewRound,0);
    assert.equal((await db.swarmMessage.count({where:{shop,caseId:item.id}})),3);

    const enabled={SWARM_EXECUTION_ENABLED:"true"};
    const evidence=["https://example.org/research"];
    const falsifier="Reject if the observed lift disappears out of sample.";
    await recordSwarmWorkerMessage({shop,caseId:item.id,senderId:researcher.id,
      kind:"hypothesis",body:"A testable claim with independent evidence sources.",
      evidenceUrls:evidence,falsifier},enabled);
    await recordSwarmWorkerMessage({shop,caseId:item.id,senderId:skeptic.id,
      kind:"challenge",body:"This could be explained by a branded keyword selection effect.",
      evidenceUrls:evidence},enabled);
    await recordSwarmWorkerMessage({shop,caseId:item.id,senderId:researcher.id,
      kind:"revision",body:"Revised with a matched control and nonbranded denominator.",
      evidenceUrls:evidence,falsifier},enabled);
    assert.equal((await db.swarmCase.findUniqueOrThrow({where:{id:item.id}})).reviewRound,1);
    await assert.rejects(recordSwarmWorkerMessage({shop,caseId:item.id,senderId:skeptic.id,
      kind:"verdict",body:"I approve despite only challenging the prior version.",
      evidenceUrls:evidence,falsifier,verdict:"supported"},enabled),/challenge/);
    await recordSwarmWorkerMessage({shop,caseId:item.id,senderId:skeptic.id,
      kind:"challenge",body:"The revision must still control for click share and temporal shifts.",
      evidenceUrls:evidence},enabled);
    const verdict=await recordSwarmWorkerMessage({shop,caseId:item.id,senderId:skeptic.id,
      kind:"verdict",body:"Sufficient evidence to propose a merchant-controlled test.",
      evidenceUrls:evidence,falsifier,verdict:"supported"},enabled);
    assert.equal(verdict.status,"awaiting_merchant_review");
    assert.equal((await db.swarmCase.findUniqueOrThrow({where:{id:item.id}})).reviewRound,1);
    assert.equal(await db.storeRecommendation.count({where:{shop}}),0,
      "a skeptical verdict must not auto-approve a Shopify store mutation");
  }finally{await eraseMerchantData(shop)}
  assert.equal(await db.swarmAgent.count({where:{shop}}),0);
  assert.equal(await db.swarmCase.count({where:{shop}}),0);
  assert.equal(await db.swarmMessage.count({where:{shop}}),0);
});
