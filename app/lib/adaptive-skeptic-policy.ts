import {parseBenchmarkAnswer,type BenchmarkLabel} from "./swarm-benchmark-policy";
import type {VerifiedShopifySnapshot} from "./swarm-evidence.server";
import type {BoundedModelAnswer} from "./swarm-execution-policy";

export const ADAPTIVE_MAX_MODEL_CALLS=3;
export const ADAPTIVE_POLICY_VERSION="adaptive-skeptic-v1" as const;
export type AdaptiveReason=
  "EXTERNAL_OUTCOME_UNVERIFIED"|"MERCHANT_ACTION_PROPOSED"|
  "NONFINAL_OR_ABSTAINING_ANSWER"|"NO_VERIFIED_FACT_REFERENCED"|
  "MODEL_CITES_UNVERIFIED_URL"|"UNSUBSTANTIATED_CAUSALITY"|
  "COVERAGE_INCOMPLETE"|"MISSING_FALSIFIER"|"STORE_FACT_CONFLICT";

export type AdaptiveRoutingDecision={
  policy:typeof ADAPTIVE_POLICY_VERSION;
  escalate:boolean;
  reasons:AdaptiveReason[];
  firstAnswer:BenchmarkLabel|null;
  maxTotalRequests:3;
  initialCalls:1;
  merchantWritesAllowed:false;
};

export function routeAdaptiveSkeptic(input:{
  title:string;hypothesis:string;metric:string;rejectionRule:string;
  snapshot:VerifiedShopifySnapshot;answer:BoundedModelAnswer;
}):AdaptiveRoutingDecision{
  const reasons:AdaptiveReason[]=[];
  const {answer,snapshot}=input;
  const label=parseBenchmarkAnswer(answer.text);
  const context=[input.title,input.hypothesis,input.metric,input.rejectionRule].join(" ");
  if(!label||label==="INSUFFICIENT")reasons.push("NONFINAL_OR_ABSTAINING_ANSWER");
  if(snapshot.allProductsHasNextPage||snapshot.publishedProductsHasNextPage)
    reasons.push("COVERAGE_INCOMPLETE");
  // The evidence snapshot cannot establish external outcomes such as traffic,
  // Google indexing, rankings, uplift or revenue. All such cases escalate,
  // even when a model returns a confident answer.
  if(/\b(?:index(?:ed|ing|ation)?|search\s+console|google|ranking|rankings|organic\s+traffic|clicks?|conversions?|revenue|sales?|roi|uplift|causal|incremental)\b/i.test(context))
    reasons.push("EXTERNAL_OUTCOME_UNVERIFIED");
  if(/\b(?:publish(?:ing)?|unpublish|edit\s+(?:product|title|price)|change\s+(?:price|theme|inventory)|send\s+(?:emails?|offers?)|purchase|advertis(?:e|ing)|update\s+(?:shop|store|catalog))\b/i.test(context+" "+answer.text))
    reasons.push("MERCHANT_ACTION_PROPOSED");
  if(/\b(?:proves?\s+(?:that\s+)?(?:google|traffic|rank|sales|conversion)|guarantee(?:s|d)?|will\s+(?:increase|improve)\s+(?:traffic|ranking|sales|revenue)|definitively\s+caused)\b/i.test(answer.text))
    reasons.push("UNSUBSTANTIATED_CAUSALITY");
  if(answer.evidenceUrls.length>0)
    reasons.push("MODEL_CITES_UNVERIFIED_URL");
  if(!answer.falsifier||answer.falsifier.trim().length<8)
    reasons.push("MISSING_FALSIFIER");
  // A literal exact source-field + value reference is necessary for early
  // exit; mere confidence or model-generated citations are never enough.
  const facts:readonly [string,string][]=[
    ["publishedActiveProductsInSample",String(snapshot.publishedActiveProductsInSample)],
    ["publishedProductsWithOnlineStoreUrl",String(snapshot.publishedProductsWithOnlineStoreUrl)],
    ["activeProductsInSample",String(snapshot.activeProductsInSample)],
    ["allProductsSampled",String(snapshot.allProductsSampled)],
    ["storefrontPasswordEnabled",String(snapshot.storefrontPasswordEnabled)],
  ];
  const linked=facts.some(([field,value])=>{
    const position=answer.text.indexOf(field);
    if(position<0)return false;
    const tail=answer.text.slice(position+field.length,position+field.length+30);
    return new RegExp("^.{0,18}\\b"+value+"\\b","i").test(tail);
  });
  if(!linked)reasons.push("NO_VERIFIED_FACT_REFERENCED");
  // Detect a particularly dangerous false attribution independently of the
  // model's chosen ANSWER label.
  if(snapshot.publishedActiveProductsInSample>0&&
    /\b(?:zero|no)\s+(?:active\s+)?published\s+products?\b/i.test(answer.text))
    reasons.push("STORE_FACT_CONFLICT");
  return {
    policy:ADAPTIVE_POLICY_VERSION,escalate:reasons.length>0,
    reasons:[...new Set(reasons)],
    firstAnswer:label,
    maxTotalRequests:ADAPTIVE_MAX_MODEL_CALLS,initialCalls:1,
    merchantWritesAllowed:false
  };
}
