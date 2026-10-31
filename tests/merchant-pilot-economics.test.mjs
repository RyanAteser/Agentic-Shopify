import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluatePilotEconomics} from "../scripts/merchant-pilot-economics.mjs";

const arm=(decision="usable",laborMinutes=10,criticalFactualErrors=0,productLinkErrors=0)=>
  ({decision,laborMinutes,criticalFactualErrors,productLinkErrors});
const pilot=()=>({
  protocol:"paired-editorial-pilot-v1",
  preregisteredAt:"2026-10-01T00:00:00Z",
  startedAt:"2026-10-02T00:00:00Z",
  plannedPairs:20,
  pairs:Array.from({length:20},(_,i)=>({
    id:"case_"+i,order:i%2?"ai-first":"manual-first",blindScored:true,merchantGroup:"group_"+String(Math.floor(i/2)).padStart(6,"0"),
    ai:arm("usable",10),manual:arm("usable",20)
  }))
});
const ledger=(cost=100,basis="invoice-backed")=>({
  protocol:"paired-editorial-costs-v1",currency:"USD",costBasis:basis,laborValueCentsPerHour:3000,
  pairs:Array.from({length:20},(_,i)=>({
    id:"case_"+i,aiExternalCostCents:cost,manualExternalCostCents:0
  }))
});

test("invoice-backed sample reports cost per passing draft, including machine fees",()=>{
  const r=evaluatePilotEconomics(pilot(),ledger());
  assert.equal(r.decisionSupport,"candidate-for-independent-cost-review");
  assert.equal(r.scenarios.declaredLaborValue.ai.externalCents,2000);
  assert.equal(r.scenarios.declaredLaborValue.ai.valuedLaborCents,10000);
  assert.equal(r.scenarios.declaredLaborValue.ai.centsPerQualityPass,600);
  assert.equal(r.scenarios.declaredLaborValue.manual.centsPerQualityPass,1000);
  assert.equal(r.scenarios.declaredLaborValue.relativeAiCostPct,-40);
  assert.equal(r.scenarios.halfLaborValue.manualMinusAiCentsPerQualityPass,150);
});

test("provider and infrastructure cost can reverse a labor-only advantage",()=>{
  const r=evaluatePilotEconomics(pilot(),ledger(600));
  assert.equal(r.editorialDecisionSupport,"candidate-for-independent-review");
  assert.equal(r.scenarios.declaredLaborValue.ai.centsPerQualityPass,1100);
  assert.equal(r.scenarios.declaredLaborValue.manual.centsPerQualityPass,1000);
  assert.equal(r.decisionSupport,"no-cost-advantage");
});

test("reported advantage is flagged when sensitive to labor opportunity valuation",()=>{
  const r=evaluatePilotEconomics(pilot(),ledger(300));
  assert.equal(r.scenarios.declaredLaborValue.ai.centsPerQualityPass,800);
  assert.equal(r.scenarios.halfLaborValue.manualMinusAiCentsPerQualityPass,-50);
  assert.equal(r.scenarios.doubleLaborValue.manualMinusAiCentsPerQualityPass,700);
  assert.equal(r.decisionSupport,"labor-value-sensitive");
});

test("estimated cost data never qualifies as invoice-supported evidence",()=>{
  assert.equal(evaluatePilotEconomics(pilot(),ledger(10,"estimated")).decisionSupport,
    "estimated-costs-only");
});

test("missing or incomplete pilot outcomes suppress cost ratios, even with cost entries",()=>{
  const p=pilot();p.pairs[1].manual=null;
  const r=evaluatePilotEconomics(p,ledger());
  assert.equal(r.decisionSupport,"insufficient-pilot-evidence");
  assert.equal(r.scenarios.declaredLaborValue,null);
  p.pairs.pop();
  const l=ledger();l.pairs.pop();
  assert.equal(evaluatePilotEconomics(p,l).scenarios.declaredLaborValue,null);
});

test("critical product or factual errors block favorable economic triage",()=>{
  const p=pilot();p.pairs[0].ai.productLinkErrors=1;
  const r=evaluatePilotEconomics(p,ledger());
  assert.equal(r.scenarios.declaredLaborValue.ai.qualityPasses,19);
  assert.equal(r.scenarios.declaredLaborValue.ai.externalCents,2000);
  assert.equal(r.decisionSupport,"editorial-gates-not-met");
});

test("zero passing drafts never produce a misleading cost per quality pass",()=>{
  const p=pilot();p.pairs.forEach(pair=>{pair.ai.decision="rejected";});
  const r=evaluatePilotEconomics(p,ledger());
  assert.equal(r.scenarios.declaredLaborValue.ai.centsPerQualityPass,null);
  assert.equal(r.scenarios.declaredLaborValue.manualMinusAiCentsPerQualityPass,null);
  assert.equal(r.decisionSupport,"zero-quality-passes");
});

test("strict cost ledger rejects missing, duplicate, unrelated or identifying fields",()=>{
  const p=pilot();
  const l=ledger();l.pairs.pop();
  assert.throws(()=>evaluatePilotEconomics(p,l),/omits a recorded pair/);
  l.pairs.push({...l.pairs[0]});
  assert.throws(()=>evaluatePilotEconomics(p,l),/duplicate/);
  l.pairs[19].id="different";
  assert.throws(()=>evaluatePilotEconomics(p,l),/unknown/);
  l.pairs[19].id="case_19";
  l.pairs[0].shop="merchant.myshopify.com";
  assert.throws(()=>evaluatePilotEconomics(p,l),/unexpected fields/);
  delete l.pairs[0].shop;
  l.externalApiKey="secret";
  assert.throws(()=>evaluatePilotEconomics(p,l),/unexpected fields/);
});

test("strict non-negative integer costs, cost basis and rate are required",()=>{
  const p=pilot(),l=ledger();
  l.pairs[0].aiExternalCostCents=NaN;
  assert.throws(()=>evaluatePilotEconomics(p,l),/aiExternalCostCents/);
  l.pairs[0].aiExternalCostCents=0.2;
  assert.throws(()=>evaluatePilotEconomics(p,l),/aiExternalCostCents/);
  l.pairs[0].aiExternalCostCents=0;
  l.laborValueCentsPerHour=-1;
  assert.throws(()=>evaluatePilotEconomics(p,l),/laborValueCentsPerHour/);
  l.laborValueCentsPerHour=3000;
  l.costBasis="unknown";
  assert.throws(()=>evaluatePilotEconomics(p,l),/costBasis/);
  l.costBasis="invoice-backed";
  l.currency="EUR";
  assert.throws(()=>evaluatePilotEconomics(p,l),/currency/);
});

test("costs on rejected attempts still appear in the expense denominator",()=>{
  const p=pilot();p.pairs[0].ai.decision="rejected";
  const r=evaluatePilotEconomics(p,ledger(150));
  assert.equal(r.scenarios.declaredLaborValue.ai.qualityPasses,19);
  assert.equal(r.scenarios.declaredLaborValue.ai.externalCents,3000);
  assert.equal(r.scenarios.declaredLaborValue.ai.totalCents,13000);
  assert.equal(r.scenarios.declaredLaborValue.ai.centsPerQualityPass,13000/19);
});

test("merchant concentration blocks a cost candidate even with apparent savings",()=>{
  const p=pilot();p.pairs.forEach(x=>{x.merchantGroup="group_000001";});
  const r=evaluatePilotEconomics(p,ledger());
  assert.equal(r.scenarios.declaredLaborValue.relativeAiCostPct,-40);
  assert.equal(r.decisionSupport,"editorial-gates-not-met");
});
test("legacy ungrouped pilot stays descriptive but cannot recommend economic adoption",()=>{
  const p=pilot();p.pairs.forEach(x=>{delete x.merchantGroup;});
  const r=evaluatePilotEconomics(p,ledger());
  assert.equal(r.scenarios.declaredLaborValue.relativeAiCostPct,-40);
  assert.equal(r.decisionSupport,"editorial-gates-not-met");
});

test("merchant-by-order confounding blocks cost candidate despite lower observed costs",()=>{
  const p=pilot();
  p.pairs.forEach((x,i)=>{x.merchantGroup="group_"+String(i%10).padStart(6,"0");});
  const r=evaluatePilotEconomics(p,ledger());
  assert.equal(r.editorialDecisionSupport,"merchant-order-confounding");
  assert.equal(r.decisionSupport,"editorial-gates-not-met");
});


test("break-even AI operating-cost budget accounts for quality passes and labor",()=>{
  const r=evaluatePilotEconomics(pilot(),ledger(100));
  const d=r.scenarios.declaredLaborValue;
  assert.equal(d.breakEvenAiExternalCentsTotal,10000);
  assert.equal(d.breakEvenAiExternalCentsPerAttempt,500);
  assert.equal(d.ai.externalCents,2000);
  assert.equal(r.scenarios.halfLaborValue.breakEvenAiExternalCentsPerAttempt,250);
  assert.equal(r.scenarios.doubleLaborValue.breakEvenAiExternalCentsPerAttempt,1000);
});

test("break-even budget falls with failed AI drafts and abstains without usable denominators",()=>{
  const p=pilot();p.pairs[0].ai.decision="rejected";
  const d=evaluatePilotEconomics(p,ledger()).scenarios.declaredLaborValue;
  assert.equal(d.breakEvenAiExternalCentsTotal,9000);
  assert.equal(d.breakEvenAiExternalCentsPerAttempt,450);
  p.pairs.forEach(x=>{x.manual.decision="rejected";});
  const noManual=evaluatePilotEconomics(p,ledger()).scenarios.declaredLaborValue;
  assert.equal(noManual.breakEvenAiExternalCentsTotal,null);
  assert.equal(noManual.breakEvenAiExternalCentsPerAttempt,null);
  p.pairs.forEach(x=>{x.manual.decision="usable";x.ai.decision="rejected";});
  const noAi=evaluatePilotEconomics(p,ledger()).scenarios.declaredLaborValue;
  assert.equal(noAi.breakEvenAiExternalCentsTotal,null);
});
