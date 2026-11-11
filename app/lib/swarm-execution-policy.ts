import {createHash} from "node:crypto";
import type {VerifiedShopifySnapshot} from "./swarm-evidence.server";
import {SwarmPolicyError, type SwarmMessageKind} from "./swarm-policy";

export const PILOT_MAX_MODEL_CALLS=6;
export const PILOT_MAX_INPUT_CHARS=9500;
export const PILOT_MAX_OUTPUT_CHARS=2500;
export const PILOT_MAX_OUTPUT_TOKENS=650;
export const PILOT_TIMEOUT_MS=20000;
export const PILOT_LEASE_MS=180000;
export type SwarmPhase="independent_hypothesis"|"independent_evidence"|"skeptic_challenge"|
  "researcher_revision"|"skeptic_recheck"|"skeptic_verdict";
export type PlannedInvocation={
  ordinal:number;agentId:string;kind:SwarmMessageKind;phase:SwarmPhase;
};
export type SwarmAgentIdentity={
  id:string;role:string;kind:string;status:string;specialty:string;
};
export type BoundedModelRequest={
  phase:SwarmPhase;system:string;prompt:string;maxOutputTokens:number;
};
export type SnapshotSourceFact={field:"publishedActiveProductsInSample"|"publishedProductsWithOnlineStoreUrl"|"activeProductsInSample"|"allProductsSampled"|"storefrontPasswordEnabled";value:string};
export type BoundedModelAnswer={
  text:string;evidenceUrls:string[];falsifier?:string;sourceFact?:SnapshotSourceFact;
  verdict?:"supported"|"rejected"|"abstain";
  inputTokens:number;outputTokens:number;
  model:string;
};
export type BoundedModelProvider={
  providerName:string;modelName:string;
  generate:(input:BoundedModelRequest)=>Promise<BoundedModelAnswer>;
};

export function planSixCallResearch(agents:readonly SwarmAgentIdentity[]):PlannedInvocation[]{
  const specialists=agents.filter(x=>x.kind==="specialist"&&x.status==="active")
    .sort((a,b)=>a.id.localeCompare(b.id));
  const skeptics=agents.filter(x=>x.kind==="skeptic"&&x.status==="active")
    .sort((a,b)=>a.id.localeCompare(b.id));
  // Explicitly block 50-agent configurations until a separate economic/quality
  // rollout is approved. Never silently ignore subscribed agents in a case.
  if(specialists.length!==2||skeptics.length!==1)throw new SwarmPolicyError(
    "Bounded worker pilot requires exactly two specialists and one assigned skeptic.",409);
  if(new Set(agents.map(x=>x.role)).size!==1||
     new Set(agents.map(x=>x.id)).size!==3 ||
     specialists.some(x=>!x.specialty)||!skeptics[0].specialty)throw new SwarmPolicyError(
    "Worker assignments are not complete.",409);
  return [
    {ordinal:0,agentId:specialists[0].id,kind:"hypothesis",phase:"independent_hypothesis"},
    {ordinal:1,agentId:specialists[1].id,kind:"evidence",phase:"independent_evidence"},
    {ordinal:2,agentId:skeptics[0].id,kind:"challenge",phase:"skeptic_challenge"},
    {ordinal:3,agentId:specialists[0].id,kind:"revision",phase:"researcher_revision"},
    {ordinal:4,agentId:skeptics[0].id,kind:"challenge",phase:"skeptic_recheck"},
    {ordinal:5,agentId:skeptics[0].id,kind:"verdict",phase:"skeptic_verdict"},
  ];
}

export function parseWorkerText(text:unknown, urls:unknown, falsifier:unknown,
  verdict:unknown, phase:SwarmPhase, sourceFact?:unknown):Pick<BoundedModelAnswer,"text"|"evidenceUrls"|"falsifier"|"verdict"|"sourceFact"> {
  if(typeof text!=="string"||text.trim().length<12||text.length>PILOT_MAX_OUTPUT_CHARS){
    throw new SwarmPolicyError("Model output was not a bounded substantive claim.");
  }
  if(!Array.isArray(urls)||urls.length>6||urls.some(x=>typeof x!=="string")) {
    throw new SwarmPolicyError("Model output had malformed evidence URLs.");
  }
  if(sourceFact!==undefined){
    if(!sourceFact||typeof sourceFact!=="object"||Array.isArray(sourceFact)){
      throw new SwarmPolicyError("Model source fact was malformed.");
    }
    const x=sourceFact as Record<string,unknown>;
    if(!["publishedActiveProductsInSample","publishedProductsWithOnlineStoreUrl",
      "activeProductsInSample","allProductsSampled","storefrontPasswordEnabled"].includes(String(x.field))||
      typeof x.value!=="string"||x.value.length>32||
      Object.keys(x).some(k=>!["field","value"].includes(k))){
      throw new SwarmPolicyError("Model source fact was malformed.");
    }
  }
  const needFalsifier=["independent_hypothesis","researcher_revision","skeptic_verdict"].includes(phase);
  if(needFalsifier&&(typeof falsifier!=="string"||falsifier.trim().length<8||falsifier.length>600)){
    throw new SwarmPolicyError("Model did not specify a falsifier.");
  }
  if(phase==="skeptic_verdict"&&
    !["supported","rejected","abstain"].includes(String(verdict))){
    throw new SwarmPolicyError("Model did not provide a valid skeptical verdict.");
  }
  // A language model cannot verify its own web citations or produce evidence
  // of true indexing/traffic solely by generating a URL. Therefore a model
  // claiming support is converted to ABSTAIN until a separate trusted
  // evidence verifier is shipped.
  const acceptedVerdict=phase==="skeptic_verdict" ?
    (verdict==="rejected"?"rejected":"abstain") : undefined;
  return {
    text:text.trim(),evidenceUrls:urls,
    falsifier:typeof falsifier==="string"?falsifier.trim():undefined,
    verdict:acceptedVerdict,
    sourceFact:sourceFact as SnapshotSourceFact|undefined
  };
}

export function buildWorkerPrompt(input:{
  phase:SwarmPhase;title:string;hypothesis:string;metric:string;
  rejectionRule:string;specialty:string;
  trustedShopifyFacts?:VerifiedShopifySnapshot;
  prior:readonly {kind:string;body:string;senderId:string}[];
}):BoundedModelRequest{
  const independent=input.phase==="independent_hypothesis"||input.phase==="independent_evidence";
  // First-pass workers are deliberately blind to prior specialist generations.
  const transcript=independent?[]:input.prior.slice(-7).map(m=>({
    kind:m.kind,body:m.body.slice(0,1000),senderId:createHash("sha256").update(m.senderId).digest("hex").slice(0,10)
  }));
  const prompt=JSON.stringify({
    task:input.title,hypothesis:input.hypothesis,metric:input.metric,
    rejectionRule:input.rejectionRule,assignedLane:input.specialty,
    phase:input.phase,previousDebate:transcript,
    verifiedReadOnlyShopifySnapshot:input.trustedShopifyFacts??null,
    responseSchema:{
      text:"Specific sourced observation, alternative mechanism, or criticism. Mark unsupported as speculation.",
      evidenceUrls:["https://source.example/path"],falsifier:"An observation that would reject the claim.",
      verdict:"supported | rejected | abstain; only for skeptical verdict phase",
      sourceFact:{field:"Exact field name from verifiedReadOnlyShopifySnapshot",value:"Exact matching value copied from the snapshot as a string"}
    }
  });
  if(prompt.length>PILOT_MAX_INPUT_CHARS)throw new SwarmPolicyError("Worker context exceeds hard input bound.",413);
  return {phase:input.phase,maxOutputTokens:PILOT_MAX_OUTPUT_TOKENS,
    system:[
      "You are a bounded Shopify growth RESEARCH worker, not a storefront operator.",
      "Assume every claim may be wrong; give falsification tests, alternative explanations and limitations.",
      "Your assigned research lane is distinct; prioritize first-principles reasoning, not SEO clichés.",
      "You have NO browsing, Google Search Console, analytics or Shopify write access.",
      "The verifiedReadOnlyShopifySnapshot was captured by the authenticated Shopify Admin API; treat its exact fields as trusted observations, not proof of Google indexing.",
      "Never assert Shopify password state or product publication from assumptions when the snapshot contains the observed value.",
      "Never invent citations, observations, rank changes, metrics or real experiments.",
      "Do not claim search indexing, lift or conversion without independent evidence.",
      "Return only a JSON object with text, evidenceUrls array, falsifier and optionally verdict.",
      "Never include credentials, user identity or unsupported numerical claims.",
      "A skeptical verdict must abstain where evidence is missing or unverified."
    ].join(" "),
    prompt};
}

export function monthKey(date:Date){
  if(!Number.isFinite(date.getTime()))throw new SwarmPolicyError("Invalid month date");
  return date.toISOString().slice(0,7);
}
export function validateModelUsage(value:BoundedModelAnswer,expectedModel:string){
  const ok=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=25000;
  if(!ok(value.inputTokens)||!ok(value.outputTokens)||value.model!==expectedModel){
    throw new SwarmPolicyError("Provider returned invalid or unmetered usage.",502);
  }
}
