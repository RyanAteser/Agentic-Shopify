/**
 * Owner-only, read-only unit-economics primitives.
 * Price cards and support expenses are explicitly ASSUMPTIONS, not invoices.
 * No billing entitlement, merchant write or external provider action occurs.
 */
export const PLAN_SCENARIOS={
  starter:{name:"Starter",priceCents:4900},
  growth:{name:"Growth",priceCents:14900},
  operator:{name:"Operator",priceCents:39900},
} as const;
export type PlanKey=keyof typeof PLAN_SCENARIOS;

export type InvocationObservation={
  provider:string;model:string;status:string;inputTokens:number;outputTokens:number;
};
export type ObservedUsage={
  shop:string;month:string;invocations:InvocationObservation[];
  blogUsageReceipts:InvocationObservation[];completeBlogJobs:number;
  generationJobs:number;drafts:number;publishedDrafts:number;
  editorialDecisions:number;reviewMinutesTotal:number;reviewMinutesReported:number;
  rankingSnapshots:number;
};
export type TokenRate={
  inputUsdPerMillion:number;outputUsdPerMillion:number;
  // Explicit published/model-specific schedule source, never inferred from tokens.
  source:string;
};
export type ScenarioAssumptions={
  rates:Record<string,TokenRate>; // exact key "provider/model"
  unobservedCallReserveCents:number;
  unmeteredBlogAllowanceCentsPerJob:number;
  externalResearchCents:number;
  infrastructureCents:number;
  supportCents:number;
  // Explicitly include license allocation and other provider costs, even if $0.
  workflowLicenseCents:number;
  processingRate:number;
  revenueShareRate:number;
};
export type EstimatedModelUsage={
  quotedCents:number;
  pricedCalls:number;
  unpricedCalls:number;
  uncertainCalls:number;
  unknownCostCents:number;
  totalAttempted:number;
  tokenInput:number;
  tokenOutput:number;
};
function assertInt(n:number,label:string){
  if(!Number.isSafeInteger(n)||n<0)throw new Error("Invalid "+label);
}
function validMoney(cents:number,label:string){assertInt(cents,label);if(cents>1e10)throw new Error("Unreasonable "+label);}
function assertRate(rate:TokenRate){
  if(!Number.isFinite(rate.inputUsdPerMillion)||!Number.isFinite(rate.outputUsdPerMillion)
     ||rate.inputUsdPerMillion<0||rate.outputUsdPerMillion<0||
     rate.inputUsdPerMillion>10000||rate.outputUsdPerMillion>10000||
     !rate.source?.trim()||rate.source.length>500)throw new Error("Invalid model rate source or price");
}
function costCents(tokens:number,priceUsdPerMillion:number){
  assertInt(tokens,"tokens");
  // Half away from zero: a $1 per 1m token rate is 1e-4 cents per token.
  return tokens*priceUsdPerMillion/10000;
}
export function modelCostEstimate(
  invocations:readonly InvocationObservation[],
  rates:Record<string,TokenRate>,
  unobservedCallReserveCents=0
):EstimatedModelUsage {
  validMoney(unobservedCallReserveCents,"uncertain-call reserve");
  let rawCents=0,pricedCalls=0,unpricedCalls=0,uncertainCalls=0,tokenInput=0,tokenOutput=0;
  for(const call of invocations){
    assertInt(call.inputTokens,"input tokens");assertInt(call.outputTokens,"output tokens");
    if(call.inputTokens>1e9||call.outputTokens>1e9)throw new Error("Unreasonable token count");
    if(!/^[\w.-]{1,90}$/.test(call.provider)||!/^[\w.-]{1,90}$/.test(call.model))
      throw new Error("Invalid provider identity");
    if(!["attempted","uncertain","committed"].includes(call.status))
      throw new Error("Unknown invocation state");
    if(call.status!=="committed"){
      // A POST can have been charged despite missing telemetry. Do not claim zero spend.
      uncertainCalls++;continue;
    }
    const rate=rates[call.provider+"/"+call.model];
    if(!rate||call.inputTokens+call.outputTokens===0){
      // A successful model call with no usable token telemetry is not free.
      unpricedCalls++;continue;
    }
    assertRate(rate);
    pricedCalls++;tokenInput+=call.inputTokens;tokenOutput+=call.outputTokens;
    rawCents+=costCents(call.inputTokens,rate.inputUsdPerMillion)
      +costCents(call.outputTokens,rate.outputUsdPerMillion);
  }
  if(!Number.isSafeInteger(Math.ceil(rawCents)))throw new Error("Unreasonable aggregate model spend");
  const quotedCents=Math.ceil(rawCents);
  return {quotedCents,pricedCalls,unpricedCalls,uncertainCalls,
    unknownCostCents:uncertainCalls*unobservedCallReserveCents,
    totalAttempted:invocations.length,tokenInput,tokenOutput};
}

export type ContributionScenario={
  plan:string;grossCents:number;processingCents:number;revenueShareCents:number;
  quotedModelCents:number;unknownCallReserveCents:number;unmeteredBlogAllowanceCents:number;incompleteBlogJobs:number;externalResearchCents:number;
  infrastructureCents:number;supportCents:number;workflowLicenseCents:number;
  modeledContributionCents:number|null;modeledMarginPct:number|null;
  observedUnpricedCalls:number;observedUncertainCalls:number;
  canPresentAsActualProfit:false;requiresProviderInvoices:true;
  unknowns:string[];
};
export function evaluatePlan(
  plan:PlanKey,usage:ObservedUsage,assumptions:ScenarioAssumptions
):ContributionScenario {
  const p=PLAN_SCENARIOS[plan];
  if(!p)throw new Error("Unknown plan scenario");
  if(!Number.isFinite(assumptions.processingRate)||assumptions.processingRate<0||
      assumptions.processingRate>1||!Number.isFinite(assumptions.revenueShareRate)||
      assumptions.revenueShareRate<0||assumptions.revenueShareRate>1)
    throw new Error("Invalid platform fee rates");
  for(const key of ["externalResearchCents","infrastructureCents","supportCents",
    "workflowLicenseCents"] as const) validMoney(assumptions[key],key);
  validMoney(assumptions.unmeteredBlogAllowanceCentsPerJob,"blog generation allowance");
  for(const label of ["generationJobs","completeBlogJobs","drafts","publishedDrafts",
    "editorialDecisions","reviewMinutesTotal","reviewMinutesReported","rankingSnapshots"] as const)
    assertInt(usage[label],label);
  if(usage.completeBlogJobs>usage.generationJobs)throw new Error("Blog usage cohort is inconsistent");
  const model=modelCostEstimate([...usage.invocations,...usage.blogUsageReceipts],
    assumptions.rates,assumptions.unobservedCallReserveCents);
  const incompleteBlogJobs=usage.generationJobs-usage.completeBlogJobs;
  const unmeteredBlogAllowanceCents=incompleteBlogJobs*assumptions.unmeteredBlogAllowanceCentsPerJob;
  if(!Number.isSafeInteger(unmeteredBlogAllowanceCents))throw new Error("Unreasonable blog allowance");
  const processingCents=Math.ceil(p.priceCents*assumptions.processingRate);
  const revenueShareCents=Math.ceil(p.priceCents*assumptions.revenueShareRate);
  const unknowns:string[]=[];
  if(model.unpricedCalls)unknowns.push(model.unpricedCalls+" committed model calls lack an exact price card");
  if(model.uncertainCalls)unknowns.push(model.uncertainCalls+" provider calls have uncertain billing outcomes");
  if(incompleteBlogJobs>0)unknowns.push(incompleteBlogJobs+" Blog Agent jobs lack complete worker-reported writer/editor usage");
  if(usage.blogUsageReceipts.length)unknowns.push("Blog token reports are n8n worker claims, not provider invoice reconciliation");
  unknowns.push("Infrastructure, external APIs, licensing, support and Shopify fees are user-supplied assumptions, not reconciled bills");
  const completeModeledCost=model.quotedCents+model.unknownCostCents+unmeteredBlogAllowanceCents+
    assumptions.externalResearchCents+assumptions.infrastructureCents+
    assumptions.supportCents+assumptions.workflowLicenseCents+
    processingCents+revenueShareCents;
  const valid=!(model.unpricedCalls||model.uncertainCalls&&assumptions.unobservedCallReserveCents===0||
    incompleteBlogJobs>0&&assumptions.unmeteredBlogAllowanceCentsPerJob===0);
  const modeledContributionCents=valid?p.priceCents-completeModeledCost:null;
  return {plan:p.name,grossCents:p.priceCents,processingCents,revenueShareCents,
    quotedModelCents:model.quotedCents,unknownCallReserveCents:model.unknownCostCents,
    unmeteredBlogAllowanceCents,incompleteBlogJobs,
    externalResearchCents:assumptions.externalResearchCents,
    infrastructureCents:assumptions.infrastructureCents,
    supportCents:assumptions.supportCents,
    workflowLicenseCents:assumptions.workflowLicenseCents,
    modeledContributionCents,modeledMarginPct:modeledContributionCents===null?null:
      Math.round(modeledContributionCents/p.priceCents*10000)/100,
    observedUnpricedCalls:model.unpricedCalls,observedUncertainCalls:model.uncertainCalls,
    canPresentAsActualProfit:false,requiresProviderInvoices:true,unknowns};
}
export function dollars(cents:number|null){
  return cents===null?"unknown":(cents/100).toFixed(2);
}

/**
 * Maximum discretionary per-merchant monthly COGS available after Shopify fees.
 * This is a pricing guardrail, not an assertion of subscription payout or profit.
 */
export function allowableServiceSpend(plan:PlanKey,input:{
  targetContributionMarginPct:number;processingRate:number;revenueShareRate:number;
}){
  const p=PLAN_SCENARIOS[plan];
  if(!p)throw new Error("Unknown plan scenario");
  if(!Number.isFinite(input.targetContributionMarginPct)||input.targetContributionMarginPct<0||
    input.targetContributionMarginPct>100||
    !Number.isFinite(input.processingRate)||input.processingRate<0||input.processingRate>1||
    !Number.isFinite(input.revenueShareRate)||input.revenueShareRate<0||input.revenueShareRate>1){
    throw new Error("Invalid margin or platform rate");
  }
  const maxAllVariableCents=Math.floor(p.priceCents*(1-input.targetContributionMarginPct/100));
  const processingCents=Math.ceil(p.priceCents*input.processingRate);
  const revenueShareCents=Math.ceil(p.priceCents*input.revenueShareRate);
  return {
    plan:p.name,targetContributionMarginPct:input.targetContributionMarginPct,
    maxAllVariableCents,platformFeesCents:processingCents+revenueShareCents,
    maxServiceCOGSCents:Math.max(0,maxAllVariableCents-processingCents-revenueShareCents),
    feasibleAfterPlatformFees:maxAllVariableCents>=processingCents+revenueShareCents
  };
}
