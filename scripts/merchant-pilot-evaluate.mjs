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
    record(p,["id","order","blindScored","ai","manual"],"pairs["+i+"]");
    if(typeof p.id!=="string"||!/^[A-Za-z0-9_-]{1,40}$/.test(p.id)||ids.has(p.id))
      fail("pair IDs must be unique opaque identifiers");
    ids.add(p.id);
    if(!["ai-first","manual-first"].includes(p.order))fail("invalid assigned order");
    if(typeof p.blindScored!=="boolean")fail("blindScored must be boolean");
    return {...p,ai:arm(p.ai,"pairs["+i+"].ai"),manual:arm(p.manual,"pairs["+i+"].manual")};
  });
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
  return {
    protocol:PROTOCOL,plannedPairs:input.plannedPairs,recordedPairs:pairs.length,
    completedPairs:complete.length,incompletePairs:input.plannedPairs-complete.length,
    orderCounts,balancedOrder,allBlindScoredAttested:allBlind,
    status:readyForReview?"ready-for-external-review":"insufficient-or-incomplete",
    ai,manual,relativeLaborPerQualityPassPct:relativeLaborPerPassPct,
    limitations:[
      "Outcomes are descriptive; registration, randomization, and blinding are self-attested, not verified.",
      "Labor minutes are self-reported, include all attempts, and exclude machine wait time and model fees.",
      "Quality pass requires human usable decision, zero critical factual errors, and zero product-link errors.",
      "Missing or incomplete pairs never count as successes; comparisons abstain until all planned pairs are complete and review gates pass.",
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
