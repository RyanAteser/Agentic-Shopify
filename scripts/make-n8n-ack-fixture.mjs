#!/usr/bin/env node
/**
 * Offline-safe fixture generator for a real n8n engine integration smoke.
 * Derives ONLY the original Webhook -> Prepare Brief -> 202 Acknowledgment
 * nodes from the shipped workflow and deliberately removes paid nodes.
 *
 * The resulting fixture must never be deployed or used with real shops.
 */
import {readFileSync,writeFileSync} from "node:fs";

const [input,output]=process.argv.slice(2);
if(!input||!output||process.argv.length!==4){
  throw new Error("Expected workflow input and isolated fixture output");
}
const w=JSON.parse(readFileSync(input,"utf8"));
if(w.active!==false)throw new Error("Original workflow must remain inactive");
const names=["Receive Draft Request","Prepare Brief","Acknowledge Job Acceptance"];
const types=[
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.code",
  "n8n-nodes-base.respondToWebhook"
];
const nodes=names.map((name,i)=>{
  const matches=w.nodes.filter(n=>n.name===name);
  if(matches.length!==1||matches[0].type!==types[i])throw new Error("Original protocol changed: "+name);
  const n=structuredClone(matches[0]);
  if("credentials" in n)throw new Error("CI fixture cannot carry credentials");
  return n;
});
if(w.connections?.[names[0]]?.main?.[0]?.[0]?.node!==names[1]||
   w.connections?.[names[1]]?.main?.[0]?.[0]?.node!==names[2]||
   w.connections?.[names[2]]?.main?.[0]?.[0]?.node!=="Draft Article"){
  throw new Error("Original paid-workflow handoff changed");
}
if(nodes[0].parameters?.httpMethod!=="POST"||
   nodes[0].parameters?.responseMode!=="responseNode"||
   nodes[0].parameters?.authentication!=="headerAuth"||
   nodes[0].parameters?.path!=="agentic-shopify-blog-generate"){
  throw new Error("Original webhook protocol changed");
}
if(nodes[2].parameters?.options?.responseCode!==202||
   nodes[2].parameters?.respondWith!=="json"||
   !nodes[2].parameters?.responseBody?.includes("jobId")){
  throw new Error("Original n8n acceptance contract changed");
}
// The CI probe has no credential store. Disable ONLY its webhook credential
// requirement and use an isolated internal Docker network. Production remains
// headerAuth and is still guarded by the app's outbound credential.
nodes[0].parameters.authentication="none";
nodes[0].parameters.path="ci-only-blog-ack";
const fixture={
  id:"ci-ack-only-v1",
  name:"CI ONLY / n8n blog acceptance / NO paid nodes",
  active:false,
  nodes,
  connections:{
    [names[0]]:{main:[[{node:names[1],type:"main",index:0}]]},
    [names[1]]:{main:[[{node:names[2],type:"main",index:0}]]}
  },
  settings:{
    executionOrder:"v1",
    saveManualExecutions:false,
    saveDataSuccessExecution:"all",
    saveDataErrorExecution:"all",
    saveExecutionProgress:false
  },
  pinData:{}
};
const raw=JSON.stringify(fixture,null,2)+"\n";
const parsed=JSON.parse(raw);
if(parsed.nodes.length!==3||parsed.nodes.some(n=>!types.includes(n.type))||
   /api\.openai\.com|YOUR-PUBLISHED-SHOPIFY-APP|gpt-4\.1-mini|httpRequest|scheduleTrigger/.test(raw)||
   parsed.nodes.some(n=>n.credentials)||
   parsed.active!==false){
  throw new Error("Fixture unexpectedly contains paid or external nodes");
}
writeFileSync(output,raw,{flag:"wx",mode:0o600});
console.log("Generated credential-free three-node n8n acceptance probe; no provider actions possible");
