import {test} from "node:test";
import assert from "node:assert/strict";
import {
  SWARM_PLANS, verifiedSwarmPlan,requiredSkeptics,
  calculateSwarmRoster,mayResizeRole,validateResearchBrief,
  assertAgentMessage,isPublicEvidenceUrl,isSwarmRole,
} from "../app/lib/swarm-policy";

test("skeptic ratio enforced per role, not pooled across dissimilar jobs",()=>{
  assert.deepEqual([0,1,5,6,10,11,50].map(requiredSkeptics),[0,1,1,2,2,3,10]);
  const agents=[
    ...Array.from({length:6},()=>({role:"seo",kind:"specialist" as const,status:"active"})),
    ...Array.from({length:2},()=>({role:"seo",kind:"skeptic" as const,status:"active"})),
    ...Array.from({length:2},()=>({role:"content",kind:"specialist" as const,status:"active"})),
    {role:"content",kind:"skeptic" as const,status:"active"}
  ];
  const state=calculateSwarmRoster(agents);
  assert.equal(state.totalSpecialists,8);
  assert.equal(state.totalSkeptics,3);
  assert.deepEqual(state.roles.seo,{specialists:6,skeptics:2});
  assert.deepEqual(state.roles.content,{specialists:2,skeptics:1});
  assert.throws(()=>calculateSwarmRoster(agents.slice(0,-1)),/Skeptic coverage/);
  assert.equal(calculateSwarmRoster([...agents,{role:"seo",kind:"specialist",status:"retired"}]).totalSpecialists,8);
});

test("untrusted plan names never grant paid subscription slots",()=>{
  const subscriptions=[{id:"gid://shopify/AppSubscription/12",name:"Agentic Swarm Scale",status:"ACTIVE"}];
  assert.equal(verifiedSwarmPlan(subscriptions,false),"free");
  assert.equal(verifiedSwarmPlan(subscriptions,true),"scale");
  assert.equal(verifiedSwarmPlan([{...subscriptions[0],status:"FROZEN"}],true),"free");
  assert.equal(verifiedSwarmPlan([{...subscriptions[0],id:"fake"}],true),"free");
  assert.equal(verifiedSwarmPlan([{...subscriptions[0],name:"Someone Else's Scale"}],true),"free");
  assert.equal(verifiedSwarmPlan(null,true),"free");
  assert.equal(SWARM_PLANS.free.specialistSlots,2);
  assert.equal(SWARM_PLANS.growth.specialistSlots,15);
  assert.equal(SWARM_PLANS.scale.specialistSlots,50);
});

test("quota accounting blocks additions and permits downgrade reductions",()=>{
  assert.deepEqual(mayResizeRole({currentTotal:2,currentRole:1,requested:2,plan:"growth"}),
    {nextTotal:3,skeptics:1});
  assert.throws(()=>mayResizeRole({currentTotal:2,currentRole:1,requested:2,plan:"free"}),/Subscription/);
  assert.deepEqual(mayResizeRole({currentTotal:10,currentRole:6,requested:5,plan:"free"}),
    {nextTotal:9,skeptics:1});
  assert.throws(()=>mayResizeRole({currentTotal:10,currentRole:6,requested:6,plan:"free"}),/Subscription/);
  assert.throws(()=>mayResizeRole({currentTotal:2,currentRole:2,requested:51,plan:"scale"}));
  assert.throws(()=>mayResizeRole({currentTotal:2,currentRole:3,requested:0,plan:"free"}));
});

test("research requires baseline metric and a reject threshold",()=>{
  const input={title:"New long-tail query opportunity",hypothesis:"A segmented SEO landing page captures overlooked searches.",
    metric:"Measure nonbrand clicks relative to comparable pages over 28 days.",
    rejectionRule:"Reject unless the held-out difference is positive."};
  assert.deepEqual(validateResearchBrief(input),input);
  for(const key of ["title","hypothesis","metric","rejectionRule"] as const){
    assert.throws(()=>validateResearchBrief({...input,[key]:" "}),/8-/);
  }
  assert.throws(()=>validateResearchBrief({...input,title:"Valid title\n\u0000injection"}));
  assert.equal(isSwarmRole("seo"),true);
  assert.equal(isSwarmRole("unbounded-code-executor"),false);
});

test("message protocol prevents specialist approval masquerading as independent skepticism",()=>{
  const base={kind:"hypothesis" as const,actorKind:"specialist" as const,
    content:"Specific falsifiable product-market hypothesis.",
    evidenceUrls:["https://example.org/research"],falsifier:"Reject if net uplift is negative"};
  assert.doesNotThrow(()=>assertAgentMessage(base));
  assert.throws(()=>assertAgentMessage({...base,kind:"verdict"}),/Specialists/);
  assert.throws(()=>assertAgentMessage({...base,actorKind:"skeptic"}),/Skeptics/);
  assert.doesNotThrow(()=>assertAgentMessage({...base,actorKind:"skeptic",kind:"challenge",evidenceUrls:[]}));
  assert.doesNotThrow(()=>assertAgentMessage({...base,actorKind:"skeptic",kind:"verdict"}));
  assert.throws(()=>assertAgentMessage({...base,actorKind:"skeptic",kind:"verdict",evidenceUrls:[]}),/evidence/);
  assert.throws(()=>assertAgentMessage({...base,falsifier:undefined}),/failure condition/);
  for(const url of ["http://example.org/a","https://localhost/admin",
    "https://127.0.0.1/admin","https://user:pass@example.org/a",
    "https://192.168.0.1/a","javascript:alert(1)"]){
    assert.equal(isPublicEvidenceUrl(url),false,url);
  }
  assert.equal(isPublicEvidenceUrl("https://shopify.dev/docs"),true);
});
