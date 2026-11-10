#!/usr/bin/env node
/**
 * Derive a full real-engine CI workflow from the inactive production source.
 * It is safe ONLY inside an egress-isolated Docker network: all paid URL
 * endpoints point to the ephemeral mock. No merchant credentials can be used.
 */
import {readFileSync,writeFileSync} from "node:fs";

const [src,dest]=process.argv.slice(2);
if(!src||!dest||process.argv.length!==4)throw new Error("Usage: source.json ci-fixture.json");
const input=JSON.parse(readFileSync(src,"utf8"));
if(input.active!==false)throw new Error("Original paid workflow must remain INACTIVE");
const expected=[
  ["Receive Draft Request","n8n-nodes-base.webhook"],
  ["Prepare Brief","n8n-nodes-base.code"],
  ["Acknowledge Job Acceptance","n8n-nodes-base.respondToWebhook"],
  ["Draft Article","n8n-nodes-base.httpRequest"],
  ["Parse Draft","n8n-nodes-base.code"],
  ["Editorial Revision","n8n-nodes-base.httpRequest"],
  ["Parse Reviewed Article","n8n-nodes-base.code"],
  ["Return Secure Draft","n8n-nodes-base.httpRequest"]
];
if(!Array.isArray(input.nodes)||input.nodes.length!==expected.length)
  throw new Error("Source workflow topology changed");
const nodes=expected.map(([name,type])=>{
  const matching=input.nodes.filter(n=>n.name===name&&n.type===type);
  if(matching.length!==1)throw new Error("Missing or duplicated source node: "+name);
  const node=structuredClone(matching[0]);
  if(node.credentials!==undefined)throw new Error("Source fixture contains credentials");
  return node;
});
const byName=new Map(nodes.map(n=>[n.name,n]));
for(const [from,to] of expected.slice(0,-1).map((p,i)=>[p[0],expected[i+1][0]])){
  const edges=input.connections?.[from]?.main?.[0];
  if(edges?.length!==1||edges[0]?.node!==to)
    throw new Error("Unexpected workflow connection: "+from+" -> "+to);
}
if(Object.keys(input.connections).length!==7)throw new Error("Unexpected extra workflow links");
const webhook=byName.get("Receive Draft Request");
if(webhook.parameters.authentication!=="headerAuth"||
  webhook.parameters.responseMode!=="responseNode"||
  webhook.parameters.httpMethod!=="POST"||
  webhook.parameters.path!=="agentic-shopify-blog-generate"||
  !/^[0-9a-f-]{36}$/.test(webhook.webhookId??"")){
  throw new Error("Production webhook specification changed");
}
webhook.parameters.authentication="none"; // CI ONLY; production headerAuth retained.
webhook.parameters.path="ci-only-blog-full";
const ack=byName.get("Acknowledge Job Acceptance");
if(ack.parameters.options?.responseCode!==202||ack.parameters.respondWith!=="json")
  throw new Error("Job acknowledgement protocol changed");
const fakeBase="http://ci-n8n-mock:8080";
for(const name of ["Draft Article","Editorial Revision"]){
  const node=byName.get(name);
  if(node.parameters.url!=="https://api.openai.com/v1/chat/completions"||
     node.parameters.authentication!=="genericCredentialType"||
     node.parameters.genericAuthType!=="httpHeaderAuth"||
     node.parameters.method!=="POST"||
     node.parameters.sendBody!==true){
    throw new Error("Source LLM API contract changed: "+name);
  }
  node.parameters.url=fakeBase+"/v1/chat/completions";
  node.parameters.authentication="none";
  delete node.parameters.genericAuthType;
}
const callback=byName.get("Return Secure Draft");
if(callback.parameters.url!=="https://YOUR-PUBLISHED-SHOPIFY-APP.example/api/agent/complete"||
  callback.parameters.method!=="POST"||
  callback.parameters.authentication!=="none"||
  callback.parameters.headerParameters?.parameters?.length!==1||
  callback.parameters.headerParameters.parameters[0].name!=="X-Agent-Key"||
  callback.parameters.headerParameters.parameters[0].value!=="={{ $json.callbackToken }}"){
  throw new Error("Source callback capability contract changed");
}
callback.parameters.url=fakeBase+"/api/agent/complete";

const fixture={
  id:"ci-blog-full-loop-v1",
  name:"CI ONLY / full blog flow / MOCKED model and callback / no paid requests",
  active:false,nodes,
  connections:structuredClone(input.connections),
  settings:{
    executionOrder:"v1",saveManualExecutions:false,
    saveDataSuccessExecution:"all",saveDataErrorExecution:"all",
    saveExecutionProgress:false
  },
  pinData:{}
};
const serialized=JSON.stringify(fixture,null,2)+"\n";
if(/api\.openai\.com|YOUR-PUBLISHED-SHOPIFY-APP|https:\/\/|sk-proj-|shpat_/.test(serialized)||
   fixture.nodes.some(n=>n.credentials||n.type.includes("scheduleTrigger"))||
   fixture.nodes.filter(n=>n.type==="n8n-nodes-base.httpRequest").some(n=>!n.parameters.url.startsWith(fakeBase+"/"))){
  throw new Error("Unsafe CI fixture: external destinations, secrets or scheduling");
}
writeFileSync(dest,serialized,{flag:"wx",mode:0o600});
console.log("Created FULL 8-node CI-only workflow with three mock HTTP endpoints; no real API URLs");
