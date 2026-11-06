import {test} from "node:test";
import assert from "node:assert/strict";
import {routeAdaptiveSkeptic} from "../app/lib/adaptive-skeptic-policy";
import {SNAPSHOT_SOURCE} from "../app/lib/swarm-evidence.server";
import type {VerifiedShopifySnapshot} from "../app/lib/swarm-evidence.server";
import type {BoundedModelAnswer} from "../app/lib/swarm-execution-policy";
const snapshot:VerifiedShopifySnapshot={
  source:SNAPSHOT_SOURCE,shop:"fixture.myshopify.com",collectedAt:new Date().toISOString(),
  storefrontPasswordEnabled:true,allProductsSampled:18,allProductsHasNextPage:false,
  activeProductsInSample:16,allProductsWithOnlineStoreUrl:0,
  publishedProductsSampled:13,publishedProductsHasNextPage:false,
  publishedActiveProductsInSample:13,publishedProductsWithOnlineStoreUrl:0
};
const answer=(text:string,evidenceUrls:string[]=[]):BoundedModelAnswer=>({
  text,evidenceUrls,falsifier:"Reject this explanation if the authenticated Shopify published count is zero.",
  inputTokens:120,outputTokens:45,model:"fake"
});
const context={
  title:"Do null product URLs prove no Online Store publication?",
  hypothesis:"No public URL field does not imply no channel publication.",
  metric:"Audit authenticated channel publication state from Shopify Admin.",
  rejectionRule:"Reject if zero active published products are observed.",
  snapshot
};
test("clear source-bound local answer takes exactly one call without declaring approval",()=>{
  const d=routeAdaptiveSkeptic({...context,answer:answer(
    "ANSWER: NO\npublishedActiveProductsInSample is 13; a missing onlineStoreUrl is not publication proof."
  )});
  assert.equal(d.escalate,false);
  assert.equal(d.firstAnswer,"NO");
  assert.deepEqual(d.reasons,[]);
  assert.equal(d.maxTotalRequests,3);
  assert.equal(d.initialCalls,1);
  assert.equal(d.merchantWritesAllowed,false);
});
test("missing or contradictory factual support triggers skepticism",()=>{
  const cases=[
    {text:"The shop seems okay without exact source facts.",code:"NONFINAL_OR_ABSTAINING_ANSWER"},
    {text:"ANSWER: INSUFFICIENT\npublishedActiveProductsInSample is 13.",code:"NONFINAL_OR_ABSTAINING_ANSWER"},
    {text:"ANSWER: YES\nI guess there is no problem.",code:"NO_VERIFIED_FACT_REFERENCED"},
    {text:"ANSWER: YES\nThere are zero active published products, despite publishedActiveProductsInSample is 13.",code:"STORE_FACT_CONFLICT"}
  ] as const;
  for(const x of cases)assert.ok(routeAdaptiveSkeptic({
    ...context,answer:answer(x.text)
  }).reasons.includes(x.code),x.text);
});
test("external Google indexing, sales or causal measurement always triggers a skeptic",()=>{
  for(const title of [
    "Is this product indexed by Google?",
    "Will this improve organic traffic?",
    "Does our conversion rate rise?",
    "Are revenue sales uplift causally due to internal links?"
  ]){
    const x=routeAdaptiveSkeptic({...context,title,
      answer:answer("ANSWER: NO\npublishedActiveProductsInSample is 13.")
    });
    assert.ok(x.reasons.includes("EXTERNAL_OUTCOME_UNVERIFIED"),title);
  }
});
test("unverified citations and proposed merchant actions cannot exit early",()=>{
  const url=routeAdaptiveSkeptic({...context,
    answer:answer("ANSWER: NO\npublishedActiveProductsInSample is 13.",["https://example.com/post"])
  });
  assert.ok(url.reasons.includes("MODEL_CITES_UNVERIFIED_URL"));
  const edit=routeAdaptiveSkeptic({...context,
    answer:answer("ANSWER: NO\npublishedActiveProductsInSample is 13. You should change price now.")
  });
  assert.ok(edit.reasons.includes("MERCHANT_ACTION_PROPOSED"));
});
test("incomplete sample never qualifies for a cheap one-agent exit",()=>{
  const x=routeAdaptiveSkeptic({...context,
    snapshot:{...snapshot,publishedProductsHasNextPage:true},
    answer:answer("ANSWER: NO\npublishedActiveProductsInSample is 13.")
  });
  assert.ok(x.reasons.includes("COVERAGE_INCOMPLETE"));
});

test("adaptive router accepts correct labeled answer with same-line punctuation, unlike frozen A/B grader",()=>{
  for(const value of [
    "ANSWER: YES. publishedActiveProductsInSample is 13.",
    "ANSWER: YES! publishedActiveProductsInSample is 13.",
    "ANSWER: YES\npublishedActiveProductsInSample is 13."
  ]){
    const x=routeAdaptiveSkeptic({...context,answer:answer(value)});
    assert.equal(x.escalate,false,value);
    assert.equal(x.firstAnswer,"YES",value);
  }
  for(const value of ["ANSWER: YESTERDAY publishedActiveProductsInSample is 13.",
    "ANSWER: YESNO publishedActiveProductsInSample is 13."]){
    const x=routeAdaptiveSkeptic({...context,answer:answer(value)});
    assert.equal(x.escalate,true,value);
  }
});
