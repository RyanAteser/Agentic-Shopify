/** Offline, privacy-minimized paired editorial pilot evaluator. No network or store access. */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const PROTOCOL="paired-editorial-pilot-v1";
function fail(message){throw new Error("Invalid pilot: "+message);}
function record(value,keys,name){
  if(!value||typeof value!=="object"||Array.isArray(value))fail(name+" must be an object");
  if(Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!(k in value)))
    fail(name+" has missing or unexpected fields");
  return value;
}
function integer(value,min,max,name){
  if(!Number.isSafeInteger(value)||value<min||value>max)
    fail(name+" must be an integer from "+min+" to "+max);
  return value;
}
function timestamp(value,name){
  if(typeof value!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)||
    !Number.isFinite(Date.parse(value)))fail(name+" must be an ISO UTC timestamp");
  return Date.parse(value);
}
function arm(value,name){
  if(value===null)return null;
  record(value,["decision","laborMinutes","criticalFactualErrors","productLinkErrors"],name);
  if(!["usable","rejected"].includes(value.decision))fail(name+".decision invalid");
  integer(value.laborMinutes,1,480,name+".laborMinutes");
  integer(value.criticalFactualErrors,0,99,name+".criticalFactualErrors");
  integer(value.productLinkErrors,0,99,name+".productLinkErrors");
  return value;
}
function summarizeArm(pairs,key){
  const outcomes=pairs.map(p=>p[key]);
  const qualityPassed=outcomes.filter(x=>x.decision==="usable"&&x.criticalFactualErrors===0&&x.productLinkErrors===0).length;
  const totalLaborMinutes=outcomes.reduce((n,x)=>n+x.laborMinutes,0);
  return {
    attempts:outcomes.length,
    humanMarkedUsable:outcomes.filter(x=>x.decision==="usable").length,
    qualityPassed,
    criticalFactualErrors:outcomes.reduce((n,x)=>n+x.criticalFactualErrors,0),
    productLinkErrors:outcomes.reduce((n,x)=>n+x.productLinkErrors,0),
    totalLaborMinutes,
    qualityPassPct:outcomes.length?100*qualityPassed/outcomes.length:null,
    laborMinutesPerQualityPass:qualityPassed?totalLaborMinutes/qualityPassed:null
  };
}
export function evaluatePilot(input){
  record(input,["protocol","preregisteredAt","startedAt","plannedPairs","pairs"],"root");
  if(input.protocol!==PROTOCOL)fail("unsupported protocol");
  if(timestamp(input.preregisteredAt,"preregisteredAt")>=timestamp(input.startedAt,"startedAt"))
    fail("registration must precede pilot start");
  integer(input.plannedPairs,1,500,"plannedPairs");
  if(!Array.isArray(input.pairs)||input.pairs.length>input.plannedPairs)
    fail("pairs exceed planned sample or are not an array");
  const ids=new Set();
  const pairs=input.pairs.map((p,i)=>{
    // Merchant groups are opaque *study-local* random labels, never shop domains.
    // Accept legacy pair records without groups for descriptive results, but do
    // not treat a single merchant's many drafts as broad merchant evidence.
    const fields=["id","order","blindScored","ai","manual"];
    const hasGroup=Object.hasOwn(p ?? {}, "merchantGroup");
    record(p,hasGroup?[...fields,"merchantGroup"]:fields,"pairs["+i+"]");
    if(hasGroup && (typeof p.merchantGroup!=="string" ||
        !/^group_[A-Za-z0-9_-]{6,40}$/.test(p.merchantGroup))) {
      fail("merchantGroup must be a study-local opaque random label");
    }
    if(typeof p.id!=="string"||!/^[A-Za-z0-9_-]{1,40}$/.test(p.id)||ids.has(p.id))
      fail("pair IDs must be unique opaque identifiers");
    ids.add(p.id);
    if(!["ai-first","manual-first"].includes(p.order))fail("invalid assigned order");
    if(typeof p.blindScored!=="boolean")fail("blindScored must be boolean");
    return {...p,ai:arm(p.ai,"pairs["+i+"].ai"),manual:arm(p.manual,"pairs["+i+"].manual")};
  });
  // A complete pilot can be dominated by one shop, even if it has 20 pairs.
  // Report only aggregate counts; never expose merchant-group labels in output.
  const groupedPairs=pairs.filter(p=>Object.hasOwn(p,"merchantGroup"));
  if(groupedPairs.length>0 && groupedPairs.length!==pairs.length) {
    fail("merchantGroup must be present on every recorded pair or none");
  }
  const merchantGroupsProvided=groupedPairs.length===input.plannedPairs;
  const groupCounts=new Map();
  for(const p of groupedPairs) {
    groupCounts.set(p.merchantGroup,(groupCounts.get(p.merchantGroup)??0)+1);
  }
  const largestGroupPairs=groupCounts.size?Math.max(...groupCounts.values()):0;
  const merchantDiversity={
    groupsProvided:merchantGroupsProvided,
    merchantGroups:groupCounts.size,
    largestGroupPairs,
    largestGroupSharePct:groupedPairs.length?100*largestGroupPairs/groupedPairs.length:null,
    // Conservative operational screen, not a cluster-adjusted power calculation.
    operationalScreenPassed:merchantGroupsProvided&&groupCounts.size>=5&&
      largestGroupPairs/input.plannedPairs<=0.25
  };
  // Global order balance can still assign every merchant to a single
  // sequence. Then merchant effects and review-order effects are confounded.
  const merchantOrderCoverage=merchantGroupsProvided?{
    groupsWithBothOrders:Array.from(groupCounts.keys()).filter(group=>{
      const orders=new Set(pairs.filter(p=>p.merchantGroup===group).map(p=>p.order));
      return orders.size===2;
    }).length,
    groupsWithSingleOrder:Array.from(groupCounts.keys()).filter(group=>{
      const orders=new Set(pairs.filter(p=>p.merchantGroup===group).map(p=>p.order));
      return orders.size===1;
    }).length
  }:null;
  const complete=pairs.filter(p=>p.ai!==null&&p.manual!==null);
  const ai=summarizeArm(complete,"ai"),manual=summarizeArm(complete,"manual");
  const orderCounts={
    aiFirst:pairs.filter(p=>p.order==="ai-first").length,
    manualFirst:pairs.filter(p=>p.order==="manual-first").length
  };
  const balancedOrder=Math.abs(orderCounts.aiFirst-orderCounts.manualFirst)<=1;
  const allBlind=pairs.length===input.plannedPairs&&pairs.every(p=>p.blindScored);
  const readyForReview=complete.length===input.plannedPairs&&complete.length>=20&&balancedOrder&&allBlind;
  const relativeLaborPerPassPct=readyForReview&&ai.laborMinutesPerQualityPass!==null&&manual.laborMinutesPerQualityPass!==null
    ?100*(ai.laborMinutesPerQualityPass/manual.laborMinutesPerQualityPass-1):null;
  // A pooled advantage can mask reversal in one review-order sequence. This
  // sensitivity check is descriptive, not an estimator of carryover or causality.
  const orderStratifiedEfficiency=readyForReview?Object.fromEntries(
    ["ai-first","manual-first"].map(order=>{
      const stratum=complete.filter(p=>p.order===order);
      const aiArm=summarizeArm(stratum,"ai"),manualArm=summarizeArm(stratum,"manual");
      const ratio=aiArm.laborMinutesPerQualityPass!==null&&manualArm.laborMinutesPerQualityPass!==null
        ?100*(aiArm.laborMinutesPerQualityPass/manualArm.laborMinutesPerQualityPass-1):null;
      return [order,{
        completedPairs:stratum.length,
        aiQualityPassed:aiArm.qualityPassed,manualQualityPassed:manualArm.qualityPassed,
        aiLaborMinutesPerQualityPass:aiArm.laborMinutesPerQualityPass,
        manualLaborMinutesPerQualityPass:manualArm.laborMinutesPerQualityPass,
        relativeLaborPerQualityPassPct:ratio
      }];
    })
  ):null;
  const orderSensitivity=!readyForReview?"not-assessed":
    Object.values(orderStratifiedEfficiency).some(x=>x.relativeLaborPerQualityPassPct===null)
      ?"inconclusive":
    Object.values(orderStratifiedEfficiency).every(x=>x.relativeLaborPerQualityPassPct<0)
      ?"consistent-ai-advantage":"order-sensitive-or-no-gain";
  // A positive pooled result can hide a negative result for several merchants.
  // Aggregate only: merchant labels must never appear in the report.
  const merchantEfficiency=readyForReview&&merchantDiversity.groupsProvided
    ?Array.from(groupCounts.keys()).map(group=>{
      const stratum=complete.filter(p=>p.merchantGroup===group);
      const a=summarizeArm(stratum,"ai"),m=summarizeArm(stratum,"manual");
      return a.laborMinutesPerQualityPass===null||m.laborMinutesPerQualityPass===null
        ?null:100*(a.laborMinutesPerQualityPass/m.laborMinutesPerQualityPass-1);
    }):null;
  const merchantSensitivity=merchantEfficiency===null?"not-assessed":
    merchantEfficiency.some(x=>x===null)?"inconclusive":
    merchantEfficiency.every(x=>x<0)?"consistent-ai-advantage":
    "merchant-heterogeneity-or-no-gain";
  const merchantSensitivitySummary=merchantEfficiency===null?null:{
    evaluatedGroups:merchantEfficiency.length,
    groupsWithAiAdvantage:merchantEfficiency.filter(x=>x!==null&&x<0).length,
    groupsWithoutAiAdvantage:merchantEfficiency.filter(x=>x!==null&&x>=0).length,
    groupsWithUndefinedComparison:merchantEfficiency.filter(x=>x===null).length
  };
  // Discordant pairs matter: aggregate quality rates alone hide which topics regress.
  const qualityPass=x=>x.decision==="usable"&&x.criticalFactualErrors===0&&x.productLinkErrors===0;
  const pairedQuality={
    bothPass:complete.filter(p=>qualityPass(p.ai)&&qualityPass(p.manual)).length,
    aiOnlyPass:complete.filter(p=>qualityPass(p.ai)&&!qualityPass(p.manual)).length,
    manualOnlyPass:complete.filter(p=>!qualityPass(p.ai)&&qualityPass(p.manual)).length,
    neitherPass:complete.filter(p=>!qualityPass(p.ai)&&!qualityPass(p.manual)).length
  };
  // This is a conservative descriptive triage, NEVER a statistical or launch approval.
  const decisionSupport=!readyForReview?"insufficient-evidence":
    ai.criticalFactualErrors>0||ai.productLinkErrors>0||ai.qualityPassed<manual.qualityPassed
      ?"quality-review-required":
    relativeLaborPerPassPct===null?"cannot-compare-efficiency":
    relativeLaborPerPassPct>=0?"no-observed-efficiency-gain":
    orderSensitivity==="inconclusive"?"order-strata-inconclusive":
    orderSensitivity!=="consistent-ai-advantage"?"order-sensitive-efficiency":
    !merchantDiversity.groupsProvided?"merchant-diversity-unverified":
    !merchantDiversity.operationalScreenPassed?"merchant-concentration-risk":
    merchantOrderCoverage.groupsWithSingleOrder>0?"merchant-order-confounding":
    merchantSensitivity==="inconclusive"?"merchant-efficiency-inconclusive":
    merchantSensitivity!=="consistent-ai-advantage"?"merchant-efficiency-heterogeneity":
    "candidate-for-independent-review";
  return {
    protocol:PROTOCOL,plannedPairs:input.plannedPairs,recordedPairs:pairs.length,
    completedPairs:complete.length,incompletePairs:input.plannedPairs-complete.length,
    orderCounts,balancedOrder,allBlindScoredAttested:allBlind,merchantDiversity,merchantOrderCoverage,
    status:readyForReview?"ready-for-external-review":"insufficient-or-incomplete",
    ai,manual,pairedQuality,
    qualityPassRateDifferencePercentagePoints:readyForReview?100*(ai.qualityPassed-manual.qualityPassed)/complete.length:null,
    relativeLaborPerQualityPassPct:relativeLaborPerPassPct,
    orderStratifiedEfficiency,orderSensitivity,merchantSensitivity,merchantSensitivitySummary,
    decisionSupport,
    limitations:[
      "Outcomes are descriptive; registration, randomization, and blinding are self-attested, not verified.",
      "Labor minutes are self-reported, include all attempts, and exclude machine wait time and model fees.",
      "Quality pass requires human usable decision, zero critical factual errors, and zero product-link errors.",
      "Missing or incomplete pairs never count as successes; comparisons abstain until all planned pairs are complete and review gates pass.",
      "The decisionSupport field is descriptive triage, not a launch, statistical non-inferiority, or publishing authorization.",
      "Order-stratified efficiency is descriptive only. Review order may affect labor, but this tool cannot identify carryover, learning or period effects; small strata can be unstable.",
      "Only completed pairs enter arm summaries; incomplete planned pairs block comparative metrics.",
      "Merchant-group labels are self-reported, study-local, and are not independently verified against distinct merchants.",
      "The five-group and 25%-maximum-concentration thresholds are operational screens, not an effective sample size calculation or a cluster-robust confidence interval.",
      "Repeated drafts from one merchant can be correlated. Even a diverse pilot requires merchant-cluster-aware replication and analysis before generalization.",
      "Per-merchant efficiency is a descriptive heterogeneity screen, not a population estimate; small groups can be unstable and all groups need valid denominators.",
      "Global counterbalancing does not guarantee within-merchant counterbalancing. Single-order merchant groups confound merchant and sequence effects and cannot receive favorable triage.",
      "No merchant revenue, conversions, retention, organic traffic, or causal lift is measured."
    ]
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)fail("usage: node scripts/merchant-pilot-evaluate.mjs pilot.json");
    const raw=readFileSync(process.argv[2]);
    if(raw.length>1024*1024)fail("input exceeds 1 MiB");
    console.log(JSON.stringify(evaluatePilot(JSON.parse(raw.toString("utf8"))),null,2));
  }catch(error){
    console.error(error instanceof Error?error.message:"Pilot evaluation failed");
    process.exitCode=1;
  }
}
