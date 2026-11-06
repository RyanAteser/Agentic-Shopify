import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {SNAPSHOT_SOURCE,type VerifiedShopifySnapshot} from "../app/lib/swarm-evidence.server";
import {
  makeObservedCapture,makeReviewerPacket,realCohortReadiness,
  type HumanReview,reviewerSubmissionTemplate,validateSubmittedReviewer,
  validateMerchantReadOnlyConsent
} from "../app/lib/swarm-real-intake";

const now=new Date("2026-11-06T23:30:00.000Z");
const snapshot=(shop="artemisti.myshopify.com"):VerifiedShopifySnapshot=>({
  source:SNAPSHOT_SOURCE,shop,collectedAt:now.toISOString(),
  allProductsSampled:18,activeProductsInSample:16,allProductsWithOnlineStoreUrl:0,
  allProductsHasNextPage:false,publishedProductsSampled:13,
  publishedActiveProductsInSample:13,publishedProductsWithOnlineStoreUrl:0,
  publishedProductsHasNextPage:false,storefrontPasswordEnabled:true
});
const salt="staging_owner_only_no_provider_calls_private_salt_928174";
function capture(shop="artemisti.myshopify.com"){
  return makeObservedCapture({
    snapshot:snapshot(shop),at:now,groupingSalt:salt,
    cohortClass:"calibration_seen_development_store",
    consentNote:"Owner explicitly authorized local dev read-only evidence audit."
  });
}
test("fresh authenticated source produces five actual observed questions as ONE correlated merchant group",()=>{
  const c=capture(),packet=makeReviewerPacket(c);
  assert.equal(c.cases.length,5);
  assert.equal(new Set(c.cases.map(x=>x.merchantGroup)).size,1);
  assert.equal(c.modelRequestsInitiated,0);
  assert.equal(c.shopifyWritesPerformed,0);
  assert.ok(c.sourceDigest.length===64);
  const plain=createHash("sha256").update(JSON.stringify(snapshot())).digest("hex");
  assert.notEqual(c.sourceDigest,plain,"Reviewer digest must not expose a guessable plain source hash.");
  assert.equal(packet.cases.length,5);
  assert.equal(packet.cohortClass,"calibration_seen_development_store");
  assert.equal(packet.cases[0].observedFields.allProductsSampled,18);
  const p=JSON.stringify(packet);
  for(const secret of ["artemisti.myshopify.com","AQ.","accessToken",
    "customer","productTitle","expectedAnswer","candidate","answerKey"]){
    assert.ok(!p.includes(secret),secret);
  }
  const status=realCohortReadiness({captures:[c],reviews:[],pairedModelCases:[]});
  assert.equal(status.capturedMerchantGroups,1);
  assert.equal(status.capturedDistinctSnapshots,1);
  assert.equal(status.observedCases,5);
  assert.equal(status.calibrationCases,5);
  assert.equal(status.eligibleHoldoutCandidateCases,0);
  assert.equal(status.humanReviewPairsAgreed,0);
  assert.equal(status.real30CaseStudyComplete,false);
  assert.equal(status.subscriberActivationAllowed,false);
});
test("a previously viewed developer shop cannot claim unseen holdout eligibility",()=>{
  assert.throws(()=>makeObservedCapture({
    snapshot:snapshot(),at:now,groupingSalt:salt,
    cohortClass:"holdout_candidate_unverified",
    consentNote:"Bounded read-only dev-shop observation under owner authority."
  }),/cannot be certified new holdout/);
});
test("source timestamp, shop identity and source salt cannot be spoofed",()=>{
  assert.throws(()=>makeObservedCapture({
    snapshot:{...snapshot(),collectedAt:"2026-10-01T00:00:00.000Z"},
    at:now,groupingSalt:salt,cohortClass:"calibration_seen_development_store",
    consentNote:"Owner approved authenticated read-only capture."
  }),/stale/);
  assert.throws(()=>makeObservedCapture({
    snapshot:snapshot(),at:now,groupingSalt:"short",
    cohortClass:"calibration_seen_development_store",
    consentNote:"Owner approved authenticated read-only capture."
  }),/salt/);
});
test("two human attestations require distinct reviewers and matching evidence, no manufactured independence",()=>{
  const c=capture(),id=c.cases[0].id;
  const a:HumanReview={caseId:id,reviewerId:"human_a",answer:"YES",
    escalationRequired:false,sourceDigest:c.sourceDigest,
    reasoning:"Authenticated bounded Shopify observation supports positive published products.",
    independentlyCompletedAttestation:true};
  const b={...a,reviewerId:"human_b"};
  const good=realCohortReadiness({captures:[c],reviews:[a,b],pairedModelCases:[]});
  assert.equal(good.humanReviewPairsAgreed,1);
  assert.equal(good.reviewerIdentityIndependentlyAuthenticated,false);
  assert.equal(good.real30CaseStudyComplete,false);
  const disputed=realCohortReadiness({
    captures:[c],reviews:[a,{...b,answer:"NO"}],pairedModelCases:[]
  });
  assert.equal(disputed.humanReviewPairsDisputed,1);
  assert.equal(disputed.humanReviewPairsAgreed,0);
  assert.throws(()=>realCohortReadiness({
    captures:[c],reviews:[a,{...b,reviewerId:a.reviewerId}],pairedModelCases:[]
  }),/Duplicate or excessive/);
  assert.throws(()=>realCohortReadiness({
    captures:[c],reviews:[{...a,sourceDigest:"0".repeat(64)}],pairedModelCases:[]
  }),/mismatched review/);
  assert.throws(()=>realCohortReadiness({
    captures:[c],reviews:[{...a,independentlyCompletedAttestation:false}],pairedModelCases:[]
  }),/attestation incomplete/);
});
test("cross-merchant cases and replayed captures fail closed",()=>{
  const c=capture();
  assert.throws(()=>realCohortReadiness({captures:[c,c],reviews:[],pairedModelCases:[]}),
    /Duplicate real observation/);
  const tampered={...c,cases:c.cases.map((x,i)=>i===0?
    {...x,merchantGroup:"m-"+"f".repeat(20)}:x)};
  assert.throws(()=>makeReviewerPacket(tampered),/integrity/);
  assert.throws(()=>realCohortReadiness({captures:[tampered],reviews:[],pairedModelCases:[]}),
    /Cross-merchant/);
});
test("read-only capture executable contains no Gemini or Shopify mutation pathway",()=>{
  const source=readFileSync(new URL("../scripts/capture-swarm-real-observation.mts",
    import.meta.url),"utf8");
  assert.match(source,/artemisti\.myshopify\.com/);
  assert.match(source,/captureVerifiedShopifySnapshot/);
  for(const unsafe of ["geminiBoundedProvider","GEMINI_API_KEY",
    "executeBoundedSwarmCase","executeAdaptiveSkepticCase","queueSwarmResearch",
    "SWARM_ENABLE_PAID_MODEL_CALLS","write_products","write_content",
    "shopify app deploy","swarmUsageMonth.update"]){
    assert.equal(source.includes(unsafe),false,unsafe);
  }
});

test("separate blank reviewer submissions contain no model answers or fabricated humans",()=>{
  const c=capture();
  const template=reviewerSubmissionTemplate(c);
  assert.equal(template.reviewerId,"");
  assert.equal(template.attestation,"");
  assert.ok(template.reviews.every(r=>r.answer===null&&
    r.escalationRequired===null&&r.reasoning===""));
  assert.throws(()=>validateSubmittedReviewer(template,c),/attestation/);
  const filled={
    ...template,reviewerId:"reviewer_01",
    attestation:"I completed these judgments independently without model or other reviewer answers.",
    reviews:template.reviews.map(r=>({
      ...r,answer:"YES",escalationRequired:false,
      reasoning:"This result is derived solely from the provided source field and is independently checked."
    }))
  };
  const result=validateSubmittedReviewer(filled,c);
  assert.equal(result.reviews.length,5);
  assert.ok(result.reviews.every(r=>r.independentlyCompletedAttestation));
  assert.throws(()=>validateSubmittedReviewer({
    ...filled,reviews:[...filled.reviews.slice(0,4),
      {...filled.reviews[4],sourceDigest:"x".repeat(64)}]
  },c),/wrong-source/);
  assert.throws(()=>validateSubmittedReviewer({
    ...filled,reviews:[...filled.reviews.slice(0,4),
      {...filled.reviews[0]}]
  },c),/wrong-source/);
});

test("reviewer tooling has no model execution, Shopify API or billing side effects",()=>{
  const source=readFileSync(new URL("../scripts/prepare-swarm-human-review.mts",
    import.meta.url),"utf8");
  for(const forbidden of ["geminiBoundedProvider","GEMINI_API_KEY","fetch(",
    "X-Shopify-Access-Token","queueSwarmResearch","swarmUsageMonth.update",
    "executeAdaptiveSkepticCase","shopify app deploy"]){
    assert.ok(!source.includes(forbidden),forbidden);
  }
});

test("new-merchant intake requires explicit bounded consent and flags identity as unverified",()=>{
  const valid={
    shop:"newly-consented-merchant.myshopify.com",
    approvedScope:"read_products",
    approvedPurpose:"bounded_storefront_seo_evidence_evaluation",
    approvedData:"aggregate_product_publication_password_url_counts_only",
    consentEvidenceReference:"consent_reference_20261106",
    consentCapturedAt:now.toISOString(),
    authorizedMerchantRepresented:true,
    independentIdentityVerification:"pending_external_verification"
  } as const;
  assert.equal(validateMerchantReadOnlyConsent(valid,now).shop,valid.shop);
  for(const bad of [
    {...valid,shop:"artemisti.myshopify.com"},
    {...valid,shop:"monikablunderbeauty-com.myshopify.com"},
    {...valid,approvedScope:"write_products"},
    {...valid,approvedPurpose:"general_research"},
    {...valid,authorizedMerchantRepresented:false},
    {...valid,consentCapturedAt:"2025-11-06T23:30:00.000Z"},
    {...valid,independentIdentityVerification:"verified"}
  ])assert.throws(()=>validateMerchantReadOnlyConsent(bad,now));
  const candidate=makeObservedCapture({
    snapshot:snapshot(valid.shop),at:now,groupingSalt:salt,
    cohortClass:"holdout_candidate_unverified",
    consentNote:"Exact bounded source scope was authorized in a locally saved consent record."
  });
  const result=realCohortReadiness({
    captures:[candidate],reviews:[],pairedModelCases:[]
  });
  assert.equal(result.eligibleHoldoutCandidateCases,5);
  assert.equal(result.eligibleHoldoutCandidateMerchantGroups,1);
  assert.equal(result.holdoutIndependenceIndependentlyVerified,false);
  assert.equal(result.subscriberActivationAllowed,false);
});

test("consented merchant collector is read-only and does not include provider or write tools",()=>{
  const s=readFileSync(new URL("../scripts/capture-swarm-consented-merchant.mts",
    import.meta.url),"utf8");
  assert.match(s,/validateMerchantReadOnlyConsent/);
  assert.match(s,/captureVerifiedShopifySnapshot/);
  for(const forbidden of ["GEMINI_API_KEY","geminiBoundedProvider",
    "executeAdaptiveSkepticCase","queueSwarmResearch","write_products",
    "write_content","shopify app deploy","swarmUsageMonth.update"]){
    assert.ok(!s.includes(forbidden),forbidden);
  }
});
