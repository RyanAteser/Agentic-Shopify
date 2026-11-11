import {createHash} from "node:crypto";
import {EVALUATION_CASES,EVALUATION_DIGEST,EVALUATION_VERSION} from "./swarm-evaluation-30";
import type {BenchmarkLabel} from "./swarm-benchmark-policy";

export type Review={
  caseId:string;reviewerId:string;answer:BenchmarkLabel;
  escalationRequired:boolean;basis:string;
};
export type Arm="single"|"adaptive";
export type ModelResult={
  caseId:string;arm:Arm;executionId:string;
  status:"completed"|"blocked_uncertain"|"failed_before_claim";
  answerText?:string;
  escalationTriggered?:boolean;
  callsAttempted:number;callsCommitted:number;
  inputTokens:number;outputTokens:number;
};
/**
 * Billing reconciliation is deliberately not inferred from token usage.
 * This type only records a bill corroborated by an owner-verified invoice;
 * importing a JSON value does not itself independently verify that invoice.
 */
export type OwnerBillingEvidence={
  provider:"google_gemini_api";billingPeriod:string;invoiceReference:string;
  reconciledChargeUsd:number;verifiedByOwner:boolean;
};
const price={inputUsdPerMillion:0.75,outputUsdPerMillion:3.75};
function parseScoredLabel(text:unknown):BenchmarkLabel|null{
  if(typeof text!=="string")return null;
  // Symmetric, preregistered treatment for both arms. A single trailing
  // punctuation mark is not a factual error; "YESNO" is not a valid label.
  const match=text.trimStart().match(
    /^ANSWER:\s*(INSUFFICIENT|YES|NO)\b(?=[\s.,!?]|$)/i
  );
  return match?match[1].toUpperCase() as BenchmarkLabel:null;
}
function safeCount(n:number){
  if(!Number.isSafeInteger(n)||n<0||n>10_000_000_000)throw new Error("Invalid model receipt count.");
  return n;
}
function money(r:ModelResult){
  return (safeCount(r.inputTokens)*price.inputUsdPerMillion+
    safeCount(r.outputTokens)*price.outputUsdPerMillion)/1_000_000;
}
function wilsonUpper(failures:number,trials:number){
  if(!trials)return null;
  const p=failures/trials,z=1.959963984540054,zz=z*z;
  const mean=p+zz/(2*trials);
  const delta=z*Math.sqrt(p*(1-p)/trials+zz/(4*trials*trials));
  return Math.min(1,(mean+delta)/(1+zz/trials));
}
function validatedReviewPair(caseId:string,records:readonly Review[]){
  const matches=records.filter(r=>r.caseId===caseId);
  const distinct=new Set(matches.map(r=>r.reviewerId));
  if(matches.length!==2||distinct.size!==2||
    matches.some(x=>x.basis.trim().length<12))return null;
  const [a,b]=matches;
  if(a.answer!==b.answer||a.escalationRequired!==b.escalationRequired)return null;
  return {answer:a.answer,escalationRequired:a.escalationRequired};
}
export function blindEvaluationPacket(){
  return {
    version:EVALUATION_VERSION,digest:EVALUATION_DIGEST,
    sourceClass:"synthetic_counterfactual_snapshot_not_30_real_merchants",
    reviewInstructions:"Two independent reviewers must supply judgments, without seeing each other's label or model output. Do not infer Google indexing from Shopify metadata.",
    cases:EVALUATION_CASES.map(c=>({
      id:c.id,category:c.family,question:c.question,snapshot:c.snapshot,
      metric:c.metric,rejectionRule:c.rejectionRule
    }))
  };
}
export function evaluateThirty(input:{
  results:readonly ModelResult[];
  reviews:readonly Review[];
  billing?:OwnerBillingEvidence;
}){
  const validCases=new Map(EVALUATION_CASES.map(c=>[c.id,c]));
  const seen=new Set<string>();
  for(const r of input.results){
    if(!validCases.has(r.caseId)||!["single","adaptive"].includes(r.arm)||
      !/^[a-z0-9-]{12,80}$/.test(r.executionId)||
      !["completed","blocked_uncertain","failed_before_claim"].includes(r.status)){
      throw new Error("Invalid case/model observation.");
    }
    const k=r.caseId+":"+r.arm;
    if(seen.has(k))throw new Error("Duplicate arm record: "+k);
    seen.add(k);
    for(const key of ["callsAttempted","callsCommitted","inputTokens","outputTokens"] as const)
      safeCount(r[key]);
    if(r.callsCommitted>r.callsAttempted||r.callsAttempted>(r.arm==="single"?1:3))
      throw new Error("Model attempt ledger is inconsistent.");
    if(r.status==="completed"&&r.callsCommitted!==r.callsAttempted)
      throw new Error("Completed run must commit all claimed attempts.");
    if(r.arm==="adaptive"&&r.status==="completed"&&![1,3].includes(r.callsCommitted))
      throw new Error("Adaptive completion must be one or three committed steps.");
    if(r.arm==="single"&&r.status==="completed"&&r.callsCommitted!==1)
      throw new Error("Single-agent completion must be exactly one call.");
    if(r.arm==="adaptive"&&r.status==="completed"&&
       r.escalationTriggered!== (r.callsCommitted===3))
      throw new Error("Adaptive route and attempt ledger disagree.");
    if(typeof r.answerText==="string"&&r.answerText.length>4000)
      throw new Error("Model answer exceeds bounded display length.");
  }
  for(const rv of input.reviews){
    if(!validCases.has(rv.caseId)||!rv.reviewerId||
      !["YES","NO","INSUFFICIENT"].includes(rv.answer)||
      typeof rv.escalationRequired!=="boolean"||
      typeof rv.basis!=="string"){
      throw new Error("Malformed independent review.");
    }
  }
  if(input.billing){
    const b=input.billing;
    if(b.provider!=="google_gemini_api"||
      !/^20\d\d-(0[1-9]|1[0-2])$/.test(b.billingPeriod)||
      typeof b.invoiceReference!=="string"||
      !/^[A-Za-z0-9 _.-]{10,120}$/.test(b.invoiceReference)||
      typeof b.verifiedByOwner!=="boolean"||
      typeof b.reconciledChargeUsd!=="number"||
      !Number.isFinite(b.reconciledChargeUsd)||b.reconciledChargeUsd<0){
      throw new Error("Invalid owner-submitted billing reference.");
    }
  }
  const each=EVALUATION_CASES.map(c=>{
    const review=validatedReviewPair(c.id,input.reviews);
    const single=input.results.find(r=>r.caseId===c.id&&r.arm==="single");
    const adaptive=input.results.find(r=>r.caseId===c.id&&r.arm==="adaptive");
    const complete=!!review&&single?.status==="completed"&&adaptive?.status==="completed";
    const labels={
      single:single?parseScoredLabel(single.answerText):null,
      adaptive:adaptive?parseScoredLabel(adaptive.answerText):null
    };
    return {
      id:c.id,reviewed:!!review,pairedComplete:!!complete,
      firstAnswer:{
        single:labels.single,adaptive:labels.adaptive
      },
      correct:complete?{
        single:labels.single===review.answer,adaptive:labels.adaptive===review.answer
      }:null,
      missedEscalation:complete&&review.escalationRequired&&adaptive.escalationTriggered===false,
      unnecessaryEscalation:complete&&!review.escalationRequired&&adaptive.escalationTriggered===true,
      priceEstimateUsd:{
        single:single?money(single):null,
        adaptive:adaptive?money(adaptive):null
      },
      modelResultAvailable:!!single&&!!adaptive,
      basis:"Independent human reviewer agreement required; scripted fixture oracle is never used for live scoring."
    };
  });
  const paired=each.filter(x=>x.pairedComplete);
  const missed=paired.filter(x=>x.missedEscalation).length;
  const reviewed=each.filter(x=>x.reviewed).length;
  const out={
    version:EVALUATION_VERSION,manifestDigest:EVALUATION_DIGEST,
    scenarioCount:EVALUATION_CASES.length,
    independentReviewPairs:reviewed,
    completePairedModelResults:paired.length,
    modelArmRecords:input.results.length,
    status:paired.length===30?"fully_scored":"incomplete_not_live_validated",
    pairedAccuracy:paired.length?{
      singleCorrect:paired.filter(x=>x.correct?.single).length,
      adaptiveCorrect:paired.filter(x=>x.correct?.adaptive).length,
      denominator:paired.length
    }:null,
    missedEscalation:paired.length?{count:missed,
      denominator:paired.length,wilson95Upper:wilsonUpper(missed,paired.length)}:null,
    unnecessaryEscalations:paired.length?paired.filter(x=>x.unnecessaryEscalation).length:null,
    costs:{
      reportedTokenPriceBasisUsd:{
        single:input.results.filter(x=>x.arm==="single").reduce((a,x)=>a+money(x),0),
        adaptive:input.results.filter(x=>x.arm==="adaptive").reduce((a,x)=>a+money(x),0)
      },
      actualGoogleInvoiceUsd:null,
      ownerReportedPeriodChargeUsd:input.billing?.verifiedByOwner?
        input.billing.reconciledChargeUsd:null,
      actualCostScope:input.billing?.verifiedByOwner?
        "owner_reported_period_total_unverified_by_this_tool":
        "unavailable_no_verified_billing_receipt",
      disclaimer:"A paid-tier token-price estimate is not actual billed cost. Invoiced monthly amount cannot be assigned to individual cases without verifiable allocation."
    },
    acceptance:{
      allowedToLaunchForSubscribers:false,
      caveat:"This synthetic scenario suite cannot authorize subscriber launch. Even 0/30 missed triggers has ~11.4% Wilson 95% upper bound. Require larger independent, multi-merchant trials and verified billing."
    },
    cases:each
  };
  return out;
}
export const BLIND_PACKET_SHA=createHash("sha256").update(JSON.stringify(blindEvaluationPacket())).digest("hex");
