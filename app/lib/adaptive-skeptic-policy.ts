import type {BenchmarkLabel} from "./swarm-benchmark-policy";
import {trustedQuestionTruth} from "./swarm-verified-question";
import type {VerifiedShopifySnapshot} from "./swarm-evidence.server";
import type {BoundedModelAnswer} from "./swarm-execution-policy";

export const ADAPTIVE_MAX_MODEL_CALLS=3;
export const ADAPTIVE_POLICY_VERSION="adaptive-skeptic-v1" as const;
export type AdaptiveReason=
  "EXTERNAL_OUTCOME_UNVERIFIED"|"MERCHANT_ACTION_PROPOSED"|
  "NONFINAL_OR_ABSTAINING_ANSWER"|"NO_VERIFIED_FACT_REFERENCED"|
  "MODEL_CITES_UNVERIFIED_URL"|"UNSUBSTANTIATED_CAUSALITY"|
  "COVERAGE_INCOMPLETE"|"MISSING_FALSIFIER"|"STORE_FACT_CONFLICT"|
  "NO_MECHANICALLY_VERIFIED_ANSWER"|"ANSWER_CONFLICTS_WITH_SHOPIFY_CHECK";

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
  // The operational router accepts a first-line "ANSWER: YES. Explanation"
  // without mistaking harmless punctuation for missing evidence. The
  // preregistered A/B benchmark parser intentionally remains unchanged.
  const labelToken=answer.text.trimStart().match(
    /^ANSWER:\s*(INSUFFICIENT|YES|NO)\b(?=[\s.!?]|$)/i
  );
  const label=labelToken?labelToken[1].toUpperCase() as BenchmarkLabel:null;
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
  // Early exit requires an exact field/value pair from the already trusted
  // snapshot. Prefer typed sourceFact. A legacy prose fallback remains for
  // older model adapters; neither model confidence nor a URL is verification.
  const facts:readonly [string,string][]=[
    ["publishedActiveProductsInSample",String(snapshot.publishedActiveProductsInSample)],
    ["publishedProductsWithOnlineStoreUrl",String(snapshot.publishedProductsWithOnlineStoreUrl)],
    ["activeProductsInSample",String(snapshot.activeProductsInSample)],
    ["allProductsSampled",String(snapshot.allProductsSampled)],
    ["storefrontPasswordEnabled",String(snapshot.storefrontPasswordEnabled)],
  ];
  const typedMatch=!!answer.sourceFact&&facts.some(
    ([field,value])=>answer.sourceFact!.field===field&&answer.sourceFact!.value===value
  );
  if(answer.sourceFact&&!typedMatch)reasons.push("STORE_FACT_CONFLICT");
  const proseMatch=facts.some(([field,value])=>{
    const position=answer.text.indexOf(field);
    if(position<0)return false;
    // Stay within this source-field clause; tolerate "is explicitly set to".
    const tail=answer.text.slice(position+field.length,position+field.length+96)
      .split(/[.;\n]/)[0];
    const hit=new RegExp("\\b"+value+"\\b","i").exec(tail);
    if(!hit)return false;
    // A negated fact is not affirmative evidence, even if the number matches.
    const prefix=tail.slice(0,hit.index);
    if(/\b(?:not|never|isn't|wasn't|doesn't|cannot|can't|instead\s+of)\b/i.test(prefix))return false;
    return true;
  });
  if(!typedMatch&&!proseMatch)reasons.push("NO_VERIFIED_FACT_REFERENCED");
  // A matching source field alone does not prove the yes/no inference.
  // Only exact, reviewed questions have an independent machine oracle.
  // All arbitrary free-form questions escalate by default, not just those
  // that fail citation formatting.
  const trusted=trustedQuestionTruth(input.title,snapshot);
  if(!trusted||trusted.label==="INSUFFICIENT"){
    reasons.push("NO_MECHANICALLY_VERIFIED_ANSWER");
  }else if(label!==trusted.label){
    reasons.push("ANSWER_CONFLICTS_WITH_SHOPIFY_CHECK");
  }
  if(trusted&&answer.sourceFact&&
    (answer.sourceFact.field!==trusted.sourceFact.field||
     answer.sourceFact.value!==trusted.sourceFact.value)){
    reasons.push("STORE_FACT_CONFLICT");
  }
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
