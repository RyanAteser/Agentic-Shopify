import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluatePlan,modelCostEstimate,type ObservedUsage,type ScenarioAssumptions} from "../app/lib/unit-economics";

const rates={"gemini-generate-content/gemini-2.5-flash-lite":{
  inputUsdPerMillion:0.10,outputUsdPerMillion:0.40,source:"Test fixture, not an invoice"
}};
const sample:ObservedUsage={
  shop:"scenario.myshopify.com",month:"2026-11",
  invocations:[
    {provider:"gemini-generate-content",model:"gemini-2.5-flash-lite",
      status:"committed",inputTokens:1_000_000,outputTokens:1_000_000},
    {provider:"gemini-generate-content",model:"gemini-2.5-flash-lite",
      status:"uncertain",inputTokens:0,outputTokens:0}
  ],
  generationJobs:3,drafts:2,publishedDrafts:1,
  editorialDecisions:1,reviewMinutesReported:1,reviewMinutesTotal:20,rankingSnapshots:5
};
const assumptions:ScenarioAssumptions={
  rates,unobservedCallReserveCents:25,externalResearchCents:700,
  infrastructureCents:600,supportCents:1500,workflowLicenseCents:0,
  processingRate:0.029,revenueShareRate:0
};
test("model token cost uses exact price card and exposes ambiguous provider charges",()=>{
  const x=modelCostEstimate(sample.invocations,rates,25);
  assert.deepEqual({calls:x.totalAttempted,priced:x.pricedCalls,unknown:x.uncertainCalls,
    quote:x.quotedCents,reserve:x.unknownCostCents},
    {calls:2,priced:1,unknown:1,quote:50,reserve:25});
  assert.equal(x.tokenInput,1_000_000);
  assert.equal(x.tokenOutput,1_000_000);
});
test("conservative tier model never represents quotes as actual subscriptions",()=>{
  const estimate=evaluatePlan("starter",sample,assumptions);
  assert.equal(estimate.grossCents,4900);
  assert.equal(estimate.processingCents,143);
  assert.equal(estimate.quotedModelCents,50);
  assert.equal(estimate.modeledContributionCents,1882);
  assert.equal(estimate.canPresentAsActualProfit,false);
  assert.equal(estimate.requiresProviderInvoices,true);
  assert.match(estimate.unknowns.join(" "),/Blog\/n8n/);
  const upper=evaluatePlan("operator",sample,{...assumptions,revenueShareRate:0.15});
  assert.equal(upper.revenueShareCents,5985);
});
test("missing model pricing or unreserved uncertain call must block numeric profit",()=>{
  const unknown=evaluatePlan("growth",sample,{...assumptions,rates:{}});
  assert.equal(unknown.modeledContributionCents,null);
  assert.equal(unknown.observedUnpricedCalls,1);
  const ambiguous=evaluatePlan("starter",sample,{...assumptions,unobservedCallReserveCents:0});
  assert.equal(ambiguous.modeledContributionCents,null);
});
test("reject malformed or unbelievable price cards, fees and token totals",()=>{
  assert.throws(()=>modelCostEstimate(sample.invocations,rates,-1),/Invalid/);
  assert.throws(()=>modelCostEstimate([{provider:"x",model:"y",status:"committed",inputTokens:-1,outputTokens:0}],rates),/Invalid/);
  assert.throws(()=>modelCostEstimate([{provider:"x",model:"y",status:"lost",inputTokens:0,outputTokens:0}],rates),/Unknown/);
  assert.throws(()=>modelCostEstimate(sample.invocations,{
    "gemini-generate-content/gemini-2.5-flash-lite":{inputUsdPerMillion:-1,outputUsdPerMillion:0,source:"x"}
  }),/Invalid/);
  assert.throws(()=>evaluatePlan("growth",sample,{...assumptions,revenueShareRate:1.5}),/Invalid/);
  assert.throws(()=>evaluatePlan("growth",sample,{...assumptions,supportCents:-5}),/Invalid/);
});
