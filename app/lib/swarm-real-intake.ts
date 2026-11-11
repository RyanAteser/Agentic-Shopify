import {createHash,createHmac,randomUUID} from "node:crypto";
import {requireVerifiedShopifySnapshot,type VerifiedShopifySnapshot} from "./swarm-evidence.server";
import type {BenchmarkLabel} from "./swarm-benchmark-policy";

export const REAL_INTAKE_VERSION="merchant-readonly-intake-v1" as const;
export type CohortClass="calibration_seen_development_store"|"holdout_candidate_unverified";
export type SourceCase={
  id:string;caseFamily:"publication"|"password"|"url_coverage"|"sample_limit"|"external_indexing";
  question:string;metric:string;rejectionRule:string;
  // Immutable observed snapshot counts only, no product identities or customer fields.
  snapshot:Omit<VerifiedShopifySnapshot,"shop">;
  evidenceDigest:string;merchantGroup:string;cohortClass:CohortClass;
  captureId:string;capturedAt:string;
};
export type PrivateMerchantCapture={
  version:typeof REAL_INTAKE_VERSION;
  captureId:string;sourceShop:string;merchantGroup:string;
  sourceDigest:string;collectedAt:string;
  cohortClass:CohortClass;
  consentNote:string;
  cases:SourceCase[];
  modelRequestsInitiated:0;shopifyWritesPerformed:0;
};
export type ReviewerPacket={
  version:typeof REAL_INTAKE_VERSION;
  captureId:string;merchantGroup:string;cohortClass:CohortClass;
  instructions:string;
  cases:{id:string;family:SourceCase["caseFamily"];question:string;
    observedFields:SourceCase["snapshot"];sourceDigest:string;
    metric:string;rejectionRule:string}[];
};
export type HumanReview={
  caseId:string;reviewerId:string;
  answer:BenchmarkLabel;escalationRequired:boolean;
  sourceDigest:string;reasoning:string;
  independentlyCompletedAttestation:boolean;
};
const sha=(input:string)=>createHash("sha256").update(input).digest("hex");
const templates=([
  {family:"publication",question:"Does this bounded authenticated snapshot contain any ACTIVE Online Store-published products?",
    metric:"Use publishedActiveProductsInSample, noting pagination.",
    rejectionRule:"Reject if zero ACTIVE published products are observed; abstain from full-store totals if pagination is incomplete."},
  {family:"password",question:"Is this store's Online Store password protection currently enabled?",
    metric:"Use onlineStore.passwordProtection.enabled in the authenticated snapshot.",
    rejectionRule:"Reject if the password flag is false, missing or unauthenticated."},
  {family:"url_coverage",question:"Does a null onlineStoreUrl for every published sampled product establish zero published ACTIVE products?",
    metric:"Compare non-null URL count with ACTIVE published-product count.",
    rejectionRule:"Reject the depublication implication if published ACTIVE products exist despite null URLs."},
  {family:"sample_limit",question:"Does this collector's bounded snapshot prove it enumerated every product?",
    metric:"Check both hasNextPage values, not merely node counts.",
    rejectionRule:"Reject completeness whenever either pagination flag indicates additional pages."},
  {family:"external_indexing",question:"Does this Shopify Admin snapshot establish that Google currently indexed any product page?",
    metric:"Distinguish Shopify Admin metadata from independent Google URL Inspection data.",
    rejectionRule:"Withhold confirmed indexing when source lacks Google Search Console evidence."}
] as const);
export function makeObservedCapture(input:{
  snapshot:VerifiedShopifySnapshot;
  groupingSalt:string;
  cohortClass:CohortClass;
  consentNote:string;
  at?:Date;captureId?:string;
}):PrivateMerchantCapture{
  const now=input.at??new Date();
  const snapshot=requireVerifiedShopifySnapshot(input.snapshot,input.snapshot.shop,now);
  if(!/^[A-Za-z0-9_-]{20,128}$/.test(input.groupingSalt))throw new Error("Private cohort pseudonym salt required.");
  if(typeof input.consentNote!=="string"||input.consentNote.length<16||input.consentNote.length>240)
    throw new Error("Document bounded data collection authority.");
  if(input.cohortClass==="holdout_candidate_unverified"&&
    /^(artemisti|monikablunderbeauty-com)\.myshopify\.com$/.test(snapshot.shop)){
    throw new Error("Previously inspected merchant cannot be certified new holdout.");
  }
  const captureId=input.captureId??randomUUID();
  if(!/^[a-f0-9-]{36}$/.test(captureId))throw new Error("Invalid capture identifier.");
  const merchantGroup="m-"+sha(input.groupingSalt+"\0"+snapshot.shop).slice(0,20);
  const {shop: _privateShop,...safeSnapshot}=snapshot;
  // Keyed source digest: a publicly known shop name and counts must not
  // allow reviewers to dictionary-recover a private merchant identity.
  const digest=createHmac("sha256",input.groupingSalt)
    .update(JSON.stringify(snapshot)).digest("hex");
  const cases:SourceCase[]=templates.map((t,index)=>({
    id:captureId+"-"+String(index+1).padStart(2,"0"),
    caseFamily:t.family,question:t.question,metric:t.metric,
    rejectionRule:t.rejectionRule,snapshot:safeSnapshot,
    evidenceDigest:digest,merchantGroup,cohortClass:input.cohortClass,
    captureId,capturedAt:snapshot.collectedAt
  }));
  return {
    version:REAL_INTAKE_VERSION,captureId,sourceShop:snapshot.shop,
    merchantGroup,sourceDigest:digest,collectedAt:snapshot.collectedAt,
    cohortClass:input.cohortClass,consentNote:input.consentNote,
    cases,modelRequestsInitiated:0,shopifyWritesPerformed:0
  };
}
export function makeReviewerPacket(capture:PrivateMerchantCapture):ReviewerPacket{
  if(capture.version!==REAL_INTAKE_VERSION||capture.cases.length!==templates.length||
     capture.cases.some(c=>c.evidenceDigest!==capture.sourceDigest||
       c.merchantGroup!==capture.merchantGroup||
       c.captureId!==capture.captureId)){
    throw new Error("Capture integrity or provenance missing.");
  }
  return {
    version:REAL_INTAKE_VERSION,captureId:capture.captureId,
    merchantGroup:capture.merchantGroup,cohortClass:capture.cohortClass,
    instructions:"Independent human review: decide YES/NO/INSUFFICIENT and whether skeptical review is needed. Never use model output or another reviewer's judgment. Shopify Admin metadata cannot prove Google indexing. No storefront changes.",
    cases:capture.cases.map(c=>({
      id:c.id,family:c.caseFamily,question:c.question,
      observedFields:c.snapshot,sourceDigest:c.evidenceDigest,
      metric:c.metric,rejectionRule:c.rejectionRule
    }))
  };
}
export function realCohortReadiness(input:{
  captures:readonly PrivateMerchantCapture[];
  reviews:readonly HumanReview[];
  pairedModelCases:readonly string[];
}){
  const known=new Map<string,SourceCase>();
  const merchantGroups=new Set<string>();
  const eligibleGroups=new Set<string>();
  const digests=new Set<string>();
  for(const cap of input.captures){
    if(cap.version!==REAL_INTAKE_VERSION||!/^m-[a-f0-9]{20}$/.test(cap.merchantGroup))
      throw new Error("Invalid capture.");
    merchantGroups.add(cap.merchantGroup);
    if(cap.cohortClass==="holdout_candidate_unverified")eligibleGroups.add(cap.merchantGroup);
    digests.add(cap.sourceDigest);
    for(const c of cap.cases){
      if(known.has(c.id))throw new Error("Duplicate real observation identifier.");
      if(c.merchantGroup!==cap.merchantGroup||c.evidenceDigest!==cap.sourceDigest)
        throw new Error("Cross-merchant or forged source reference.");
      known.set(c.id,c);
    }
  }
  const reviews=new Map<string,HumanReview[]>();
  for(const r of input.reviews){
    const c=known.get(r.caseId);
    if(!c||c.evidenceDigest!==r.sourceDigest)throw new Error("Unknown or mismatched review source.");
    if(!r.reviewerId||!/^[A-Za-z0-9_-]{5,64}$/.test(r.reviewerId)||
      !["YES","NO","INSUFFICIENT"].includes(r.answer)||
      typeof r.escalationRequired!=="boolean"||
      !r.independentlyCompletedAttestation||r.reasoning.trim().length<24){
      throw new Error("Human reviewer attestation incomplete.");
    }
    reviews.set(r.caseId,[...(reviews.get(r.caseId)??[]),r]);
  }
  let doubleReviewed=0,disputed=0;
  for(const [id,set] of reviews){
    if(set.length>2||new Set(set.map(r=>r.reviewerId)).size!==set.length)
      throw new Error("Duplicate or excessive reviewer attestations for "+id);
    if(set.length===2){
      if(set[0].answer!==set[1].answer||
         set[0].escalationRequired!==set[1].escalationRequired)disputed++;
      else doubleReviewed++;
    }
  }
  const eligibleCaseIds=new Set([...known.values()].filter(c=>
    c.cohortClass==="holdout_candidate_unverified").map(c=>c.id));
  const pairedUnique=new Set(input.pairedModelCases);
  if(pairedUnique.size!==input.pairedModelCases.length||
     [...pairedUnique].some(id=>!known.has(id)))throw new Error("Invalid paired model receipt references.");
  const eligiblePaired=[...pairedUnique].filter(id=>eligibleCaseIds.has(id)&&
    (reviews.get(id)?.length??0)===2&&
    reviews.get(id)![0].answer===reviews.get(id)![1].answer&&
    reviews.get(id)![0].escalationRequired===reviews.get(id)![1].escalationRequired);
  return {
    capturedMerchantGroups:merchantGroups.size,
    capturedDistinctSnapshots:digests.size,
    observedCases:known.size,
    calibrationCases:[...known.values()].filter(c=>c.cohortClass!=="holdout_candidate_unverified").length,
    eligibleHoldoutCandidateMerchantGroups:eligibleGroups.size,
    eligibleHoldoutCandidateCases:eligibleCaseIds.size,
    humanReviewPairsAgreed:doubleReviewed,
    humanReviewPairsDisputed:disputed,
    eligiblePairedModelCases:eligiblePaired.length,
    // Human identity and consent must be independently authenticated to
    // upgrade candidate groups, beyond this offline attestation format.
    reviewerIdentityIndependentlyAuthenticated:false,
    holdoutIndependenceIndependentlyVerified:false,
    real30CaseStudyComplete:false,
    subscriberActivationAllowed:false,
    limitation:"Candidate source and human attestation alone cannot establish independent merchants, reviewer identity, or actual Google billing."
  };
}


export type ReviewerSubmission={
  captureId:string;
  reviewerId:string;
  attestation:"I completed these judgments independently without model or other reviewer answers.";
  reviews:HumanReview[];
};
export function reviewerSubmissionTemplate(capture:PrivateMerchantCapture){
  return {
    captureId:capture.captureId,reviewerId:"",
    attestation:"",
    reviews:capture.cases.map(c=>({
      caseId:c.id,sourceDigest:c.evidenceDigest,
      answer:null,escalationRequired:null,reasoning:""
    }))
  };
}
export function validateSubmittedReviewer(
  input:unknown,capture:PrivateMerchantCapture
):ReviewerSubmission{
  if(!input||typeof input!=="object"||Array.isArray(input))
    throw new Error("Reviewer submission missing.");
  const a=input as Record<string,unknown>;
  if(a.captureId!==capture.captureId||
    typeof a.reviewerId!=="string"||
    !/^[A-Za-z0-9_-]{5,64}$/.test(a.reviewerId)||
    a.attestation!=="I completed these judgments independently without model or other reviewer answers."||
    !Array.isArray(a.reviews)||a.reviews.length!==capture.cases.length){
    throw new Error("Reviewer attestation not complete.");
  }
  const byCase=new Map(capture.cases.map(c=>[c.id,c]));
  const seen=new Set<string>();
  const reviews:HumanReview[]=[];
  for(const unknown of a.reviews){
    if(!unknown||typeof unknown!=="object"||Array.isArray(unknown))
      throw new Error("Malformed reviewer entry.");
    const x=unknown as Record<string,unknown>;
    if(typeof x.caseId!=="string"||seen.has(x.caseId)||
      !byCase.has(x.caseId)||x.sourceDigest!==byCase.get(x.caseId)?.evidenceDigest||
      !["YES","NO","INSUFFICIENT"].includes(String(x.answer))||
      typeof x.escalationRequired!=="boolean"||
      typeof x.reasoning!=="string"||x.reasoning.trim().length<24||
      x.reasoning.length>2500){
      throw new Error("Reviewer judgment incomplete or wrong-source.");
    }
    seen.add(x.caseId);
    reviews.push({
      caseId:x.caseId,reviewerId:a.reviewerId as string,
      sourceDigest:x.sourceDigest as string,
      answer:x.answer as BenchmarkLabel,
      escalationRequired:x.escalationRequired as boolean,
      reasoning:x.reasoning as string,
      independentlyCompletedAttestation:true
    });
  }
  return {
    captureId:capture.captureId,reviewerId:a.reviewerId as string,
    attestation:a.attestation as ReviewerSubmission["attestation"],reviews
  };
}


export type MerchantReadOnlyConsent={
  shop:string;
  approvedScope:"read_products";
  approvedPurpose:"bounded_storefront_seo_evidence_evaluation";
  approvedData:"aggregate_product_publication_password_url_counts_only";
  consentEvidenceReference:string;
  consentCapturedAt:string;
  authorizedMerchantRepresented:boolean;
  independentIdentityVerification:"pending_external_verification";
};
export function validateMerchantReadOnlyConsent(
  unknown:unknown,now=new Date()
):MerchantReadOnlyConsent{
  if(!unknown||typeof unknown!=="object"||Array.isArray(unknown))
    throw new Error("Explicit merchant consent required.");
  const c=unknown as Record<string,unknown>;
  if(typeof c.shop!=="string"||
    !/^[a-z0-9][a-z0-9-]{2,70}\.myshopify\.com$/.test(c.shop)||
    /^(artemisti|monikablunderbeauty-com)\.myshopify\.com$/.test(c.shop)||
    c.approvedScope!=="read_products"||
    c.approvedPurpose!=="bounded_storefront_seo_evidence_evaluation"||
    c.approvedData!=="aggregate_product_publication_password_url_counts_only"||
    c.authorizedMerchantRepresented!==true||
    c.independentIdentityVerification!=="pending_external_verification"||
    typeof c.consentEvidenceReference!=="string"||
    !/^[A-Za-z0-9_.-]{12,100}$/.test(c.consentEvidenceReference)||
    typeof c.consentCapturedAt!=="string"){
    throw new Error("Merchant authorization missing, stale or out of scope.");
  }
  const when=Date.parse(c.consentCapturedAt);
  if(!Number.isFinite(when)||when>now.getTime()||
     now.getTime()-when>30*24*3600*1000){
    throw new Error("Merchant authorization stale.");
  }
  return unknown as MerchantReadOnlyConsent;
}
