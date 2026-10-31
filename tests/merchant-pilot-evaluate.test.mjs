import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluatePilot} from "../scripts/merchant-pilot-evaluate.mjs";

const outcome=(decision="usable",laborMinutes=10,criticalFactualErrors=0,productLinkErrors=0)=>
  ({decision,laborMinutes,criticalFactualErrors,productLinkErrors});
const pair=i=>({
  id:"case_"+i,order:i%2?"ai-first":"manual-first",blindScored:true,merchantGroup:"group_"+String(Math.floor(i/2)).padStart(6,"0"),
  ai:outcome("usable",10),manual:outcome("usable",20)
});
const pilot=(n=20)=>({
  protocol:"paired-editorial-pilot-v1",preregisteredAt:"2026-10-01T00:00:00Z",
  startedAt:"2026-10-02T00:00:00Z",plannedPairs:n,
  pairs:Array.from({length:n},(_,i)=>pair(i))
});

test("complete counterbalanced pilot reports descriptive labor per quality pass",()=>{
  const r=evaluatePilot(pilot());
  assert.equal(r.status,"ready-for-external-review");
  assert.equal(r.ai.qualityPassed,20);
  assert.equal(r.ai.laborMinutesPerQualityPass,10);
  assert.equal(r.manual.laborMinutesPerQualityPass,20);
  assert.equal(r.relativeLaborPerQualityPassPct,-50);
  assert.equal(r.incompletePairs,0);
});
test("rejections and factual or link errors consume labor without counting as usable",()=>{
  const p=pilot();
  p.pairs[0].ai=outcome("rejected",5);
  p.pairs[1].ai=outcome("usable",10,1);
  p.pairs[2].ai=outcome("usable",10,0,1);
  const r=evaluatePilot(p);
  assert.equal(r.ai.humanMarkedUsable,19);
  assert.equal(r.ai.qualityPassed,17);
  assert.equal(r.ai.totalLaborMinutes,195);
  assert.equal(r.ai.laborMinutesPerQualityPass,195/17);
});
test("missing outcomes and missing planned pairs block relative comparisons",()=>{
  const p=pilot();p.pairs[0].manual=null;
  const r=evaluatePilot(p);
  assert.equal(r.completedPairs,19);
  assert.equal(r.incompletePairs,1);
  assert.equal(r.relativeLaborPerQualityPassPct,null);
  p.pairs.pop();
  assert.equal(evaluatePilot(p).incompletePairs,2);
});
test("small, unblinded, and imbalanced pilots abstain",()=>{
  assert.equal(evaluatePilot(pilot(5)).relativeLaborPerQualityPassPct,null);
  const p=pilot();p.pairs[0].blindScored=false;
  assert.equal(evaluatePilot(p).relativeLaborPerQualityPassPct,null);
  p.pairs[0].blindScored=true;
  p.pairs.forEach(x=>{x.order="ai-first";});
  assert.equal(evaluatePilot(p).balancedOrder,false);
  assert.equal(evaluatePilot(p).relativeLaborPerQualityPassPct,null);
});
test("zero passing outcomes never divides by zero",()=>{
  const p=pilot();p.pairs.forEach(x=>{x.ai=outcome("rejected",8);});
  const r=evaluatePilot(p);
  assert.equal(r.ai.laborMinutesPerQualityPass,null);
  assert.equal(r.relativeLaborPerQualityPassPct,null);
});
test("strict privacy-minimized schema rejects content, merchant IDs, duplicates and bad metrics",()=>{
  const p=pilot();p.pairs[0].shop="example.myshopify.com";
  assert.throws(()=>evaluatePilot(p),/unexpected fields/);
  delete p.pairs[0].shop;
  p.pairs[1].id=p.pairs[0].id;
  assert.throws(()=>evaluatePilot(p),/unique opaque/);
  p.pairs[1].id="case_1";
  p.pairs[0].ai.laborMinutes=-1;
  assert.throws(()=>evaluatePilot(p),/laborMinutes/);
  p.pairs[0].ai.laborMinutes=10;
  p.pairs[0].ai.body="merchant text";
  assert.throws(()=>evaluatePilot(p),/unexpected fields/);
});
test("registration must precede start and planned sample is bounded",()=>{
  const p=pilot();p.preregisteredAt=p.startedAt;
  assert.throws(()=>evaluatePilot(p),/registration must precede/);
  p.preregisteredAt="2026-10-01T00:00:00Z";
  p.plannedPairs=501;
  assert.throws(()=>evaluatePilot(p),/plannedPairs/);
});

test("paired discordance exposes topic-specific quality regressions even when rates tie",()=>{
  const p=pilot();
  p.pairs[0].ai=outcome("rejected",5);
  p.pairs[1].manual=outcome("rejected",20);
  const r=evaluatePilot(p);
  assert.deepEqual(r.pairedQuality,{bothPass:18,aiOnlyPass:1,manualOnlyPass:1,neitherPass:0});
  assert.equal(r.qualityPassRateDifferencePercentagePoints,0);
  assert.equal(r.decisionSupport,"candidate-for-independent-review");
});

test("quality regressions block positive triage despite faster AI labor",()=>{
  const p=pilot();
  p.pairs[0].ai=outcome("usable",5,1,0);
  const r=evaluatePilot(p);
  assert.equal(r.pairedQuality.manualOnlyPass,1);
  assert.equal(r.ai.qualityPassed,19);
  assert.ok(r.relativeLaborPerQualityPassPct<0);
  assert.equal(r.decisionSupport,"quality-review-required");
});

test("any AI product-link error requires review even if manual quality is worse",()=>{
  const p=pilot();
  p.pairs[0].manual=outcome("rejected",20);
  p.pairs[1].ai=outcome("usable",10,0,1);
  const r=evaluatePilot(p);
  assert.equal(r.ai.qualityPassed,r.manual.qualityPassed);
  assert.equal(r.decisionSupport,"quality-review-required");
});

test("no efficiency gain and zero passing output never imply candidate status",()=>{
  const p=pilot();
  p.pairs.forEach(x=>{x.ai=outcome("usable",30);});
  assert.equal(evaluatePilot(p).decisionSupport,"no-observed-efficiency-gain");
  p.pairs.forEach(x=>{x.ai=outcome("rejected",5);x.manual=outcome("rejected",5);});
  assert.equal(evaluatePilot(p).decisionSupport,"cannot-compare-efficiency");
});

test("incomplete pilots abstain from quality comparison and triage",()=>{
  const p=pilot();p.pairs[0].manual=null;
  const r=evaluatePilot(p);
  assert.equal(r.decisionSupport,"insufficient-evidence");
  assert.equal(r.qualityPassRateDifferencePercentagePoints,null);
  assert.equal(r.pairedQuality.bothPass,19);
  assert.equal(r.ai.attempts,19);
});

test("review-order reversal blocks favorable triage despite pooled AI advantage",()=>{
  const p=pilot();
  p.pairs.forEach(x=>{
    x.ai=outcome("usable",x.order==="ai-first"?5:25);
    x.manual=outcome("usable",20);
  });
  const r=evaluatePilot(p);
  assert.equal(r.relativeLaborPerQualityPassPct,-25);
  assert.equal(r.orderSensitivity,"order-sensitive-or-no-gain");
  assert.equal(r.orderStratifiedEfficiency["ai-first"].relativeLaborPerQualityPassPct,-75);
  assert.equal(r.orderStratifiedEfficiency["manual-first"].relativeLaborPerQualityPassPct,25);
  assert.equal(r.decisionSupport,"order-sensitive-efficiency");
});

test("both review-order strata must show lower quality-adjusted labor for candidate triage",()=>{
  const r=evaluatePilot(pilot());
  assert.equal(r.orderSensitivity,"consistent-ai-advantage");
  assert.equal(r.orderStratifiedEfficiency["ai-first"].completedPairs,10);
  assert.equal(r.orderStratifiedEfficiency["manual-first"].completedPairs,10);
  assert.equal(r.decisionSupport,"candidate-for-independent-review");
});

test("undefined sequence efficiency abstains rather than treating zero quality passes as savings",()=>{
  const p=pilot();
  p.pairs.filter(x=>x.order==="manual-first").forEach(x=>{
    x.manual=outcome("rejected",20);
  });
  const r=evaluatePilot(p);
  assert.equal(r.relativeLaborPerQualityPassPct,-75);
  assert.equal(r.orderStratifiedEfficiency["manual-first"].relativeLaborPerQualityPassPct,null);
  assert.equal(r.orderSensitivity,"inconclusive");
  assert.equal(r.decisionSupport,"order-strata-inconclusive");
});

test("incomplete pilot suppresses order-stratified efficiency entirely",()=>{
  const p=pilot();p.pairs[0].ai=null;
  const r=evaluatePilot(p);
  assert.equal(r.orderStratifiedEfficiency,null);
  assert.equal(r.orderSensitivity,"not-assessed");
  assert.equal(r.decisionSupport,"insufficient-evidence");
});

test("legacy anonymized pilots remain readable but cannot claim multi-merchant support",()=>{
  const p=pilot();
  p.pairs.forEach(x=>{delete x.merchantGroup;});
  const r=evaluatePilot(p);
  assert.equal(r.status,"ready-for-external-review");
  assert.equal(r.relativeLaborPerQualityPassPct,-50);
  assert.equal(r.merchantDiversity.groupsProvided,false);
  assert.equal(r.decisionSupport,"merchant-diversity-unverified");
});

test("a single merchant cannot be treated as twenty independent merchant pilots",()=>{
  const p=pilot();
  p.pairs.forEach(x=>{x.merchantGroup="group_000001";});
  const r=evaluatePilot(p);
  assert.equal(r.merchantDiversity.merchantGroups,1);
  assert.equal(r.merchantDiversity.largestGroupPairs,20);
  assert.equal(r.merchantDiversity.largestGroupSharePct,100);
  assert.equal(r.decisionSupport,"merchant-concentration-risk");
});

test("a few merchants dominating otherwise balanced observations block favorable triage",()=>{
  const p=pilot();
  p.pairs.forEach((x,i)=>{x.merchantGroup=i<10?"group_000001":"group_"+String(i).padStart(6,"0");});
  const r=evaluatePilot(p);
  assert.equal(r.merchantDiversity.merchantGroups,11);
  assert.equal(r.merchantDiversity.largestGroupSharePct,50);
  assert.equal(r.merchantDiversity.operationalScreenPassed,false);
  assert.equal(r.decisionSupport,"merchant-concentration-risk");
});

test("multiple balanced study-local groups qualify for independent assessment, not statistical proof",()=>{
  const r=evaluatePilot(pilot());
  assert.equal(r.merchantDiversity.groupsProvided,true);
  assert.equal(r.merchantDiversity.merchantGroups,10);
  assert.equal(r.merchantDiversity.largestGroupPairs,2);
  assert.equal(r.merchantDiversity.operationalScreenPassed,true);
  assert.equal(r.decisionSupport,"candidate-for-independent-review");
  assert.equal(JSON.stringify(r).includes("group_000001"),false);
});

test("group IDs must be opaque, complete, non-identifying and nonempty",()=>{
  const p=pilot();
  p.pairs[0].merchantGroup="merchant.myshopify.com";
  assert.throws(()=>evaluatePilot(p),/merchantGroup/);
  p.pairs[0].merchantGroup="group_000000";
  delete p.pairs[0].merchantGroup;
  assert.throws(()=>evaluatePilot(p),/merchantGroup must be present/);
  p.pairs[0].merchantGroup="group_000000";
  p.pairs[0].merchantGroup="";
  assert.throws(()=>evaluatePilot(p),/merchantGroup/);
});

test("pooled and review-order savings cannot hide merchant-level reversal",()=>{
  const p=pilot();
  p.pairs.forEach((x,i)=>{
    // Each group occurs in both order strata. One group is slower on AI.
    x.ai=outcome("usable",Math.floor(i/2)===0?30:5);
    x.manual=outcome("usable",20);
  });
  const r=evaluatePilot(p);
  assert.ok(r.relativeLaborPerQualityPassPct<0);
  assert.equal(r.orderSensitivity,"consistent-ai-advantage");
  assert.equal(r.merchantSensitivity,"merchant-heterogeneity-or-no-gain");
  assert.equal(r.merchantSensitivitySummary.groupsWithoutAiAdvantage,1);
  assert.equal(r.merchantSensitivitySummary.groupsWithAiAdvantage,9);
  assert.equal(r.decisionSupport,"merchant-efficiency-heterogeneity");
  assert.equal(JSON.stringify(r).includes("group_000000"),false);
});
test("missing quality pass for a merchant does not imply an efficiency gain",()=>{
  const p=pilot();
  p.pairs.filter(x=>x.merchantGroup==="group_000000").forEach(x=>{x.manual=outcome("rejected",20);});
  const r=evaluatePilot(p);
  assert.equal(r.merchantSensitivity,"inconclusive");
  assert.equal(r.merchantSensitivitySummary.groupsWithUndefinedComparison,1);
  assert.equal(r.decisionSupport,"merchant-efficiency-inconclusive");
});
test("incomplete and ungrouped pilots never calculate merchant sensitivity",()=>{
  const p=pilot();p.pairs[0].ai=null;
  assert.equal(evaluatePilot(p).merchantSensitivity,"not-assessed");
  p.pairs[0].ai=outcome();
  p.pairs.forEach(x=>{delete x.merchantGroup;});
  const r=evaluatePilot(p);
  assert.equal(r.merchantSensitivity,"not-assessed");
  assert.equal(r.merchantSensitivitySummary,null);
});

test("global review-order balance cannot conceal merchant-order confounding",()=>{
  const p=pilot();
  p.pairs.forEach((x,i)=>{x.merchantGroup="group_"+String(i%10).padStart(6,"0");});
  const r=evaluatePilot(p);
  assert.equal(r.balancedOrder,true);
  assert.equal(r.merchantDiversity.operationalScreenPassed,true);
  assert.equal(r.merchantOrderCoverage.groupsWithBothOrders,0);
  assert.equal(r.merchantOrderCoverage.groupsWithSingleOrder,10);
  assert.equal(r.decisionSupport,"merchant-order-confounding");
});
test("within-merchant balanced order allows independent review triage",()=>{
  const r=evaluatePilot(pilot());
  assert.equal(r.merchantOrderCoverage.groupsWithBothOrders,10);
  assert.equal(r.merchantOrderCoverage.groupsWithSingleOrder,0);
  assert.equal(r.decisionSupport,"candidate-for-independent-review");
});
test("legacy pilots do not reveal merchant-order coverage",()=>{
  const p=pilot();p.pairs.forEach(x=>{delete x.merchantGroup;});
  assert.equal(evaluatePilot(p).merchantOrderCoverage,null);
});

// Exercise the CLI boundary, not just the in-memory evaluator.
test("CLI rejects oversized pilot input before attempting to parse it", async()=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import("node:fs");
  const {tmpdir}=await import("node:os");
  const {join}=await import("node:path");
  const {spawnSync}=await import("node:child_process");
  const dir=mkdtempSync(join(tmpdir(),"merchant-pilot-size-"));
  try {
    const file=join(dir,"oversized.json");
    writeFileSync(file,"x".repeat(1024*1024+1));
    const run=spawnSync(process.execPath,["scripts/merchant-pilot-evaluate.mjs",file],{encoding:"utf8"});
    assert.notEqual(run.status,0);
    assert.match(run.stderr,/input exceeds 1 MiB/);
    assert.doesNotMatch(run.stderr,/Unexpected token|JSON/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
