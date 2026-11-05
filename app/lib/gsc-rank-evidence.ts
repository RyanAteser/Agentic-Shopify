/**
 * Offline, retrospective corroboration of one Google SERP ranking incident.
 * Does not fetch GSC data, alter a merchant store, or establish causation.
 * Requires an independently exported, narrowly filtered Search Analytics response.
 */
import {matchesPrimaryDomain,parseSearchConsoleRows} from "./growth";

type Input = {
  primaryHost:string;
  incident:{keyword:string;targetUrl:string;country:string;device:string;engine:string;observedAt:string};
  request:{
    siteUrl:string;startDate:string;endDate:string;dimensions:string[];
    type:string;dataState:string;aggregationType:string;rowLimit?:number;startRow?:number;
    dimensionFilterGroups:Array<{groupType:string;filters:Array<{
      dimension:string;operator:string;expression:string
    }>}>
  };
  response:{responseAggregationType:string;rows?:unknown};
};

const DAY=86400000;
function dateOnly(value:string):Date {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error("Invalid reporting date");
  const date=new Date(value+"T00:00:00.000Z");
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)
    throw new Error("Invalid reporting date");
  return date;
}
function shift(date:string,days:number):string {
  return new Date(dateOnly(date).getTime()+days*DAY).toISOString().slice(0,10);
}
function pacificDay(date:Date):string {
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+"-"+p.month+"-"+p.day;
}
function summarize(rows:Array<{clicks:number;impressions:number;position:number}>) {
  const clicks=rows.reduce((sum,row)=>sum+row.clicks,0);
  const impressions=rows.reduce((sum,row)=>sum+row.impressions,0);
  const weighted=rows.reduce((sum,row)=>sum+row.position*row.impressions,0);
  return {days:rows.length,clicks,impressions,
    ctr:impressions?clicks/impressions:null,
    avgPosition:impressions?weighted/impressions:null};
}
export function assessGscRankEvidence(raw:unknown,now=new Date()) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||!Number.isFinite(now.getTime()))
    throw new Error("Invalid offline evidence input");
  const input=raw as Input, incident=input.incident,request=input.request,response=input.response;
  if(!incident||!request||!response||typeof input.primaryHost!=="string")
    throw new Error("Missing incident, request or response");
  if(!matchesPrimaryDomain(request.siteUrl,input.primaryHost))
    throw new Error("GSC property must match the exact HTTPS storefront host");
  if(incident.engine!=="google"||typeof incident.keyword!=="string"||
    !incident.keyword.trim()||typeof incident.targetUrl!=="string"||
    !/^[a-z]{3}$/.test(incident.country)||!["DESKTOP","MOBILE","TABLET"].includes(incident.device))
    throw new Error("Expected one Google search market with GSC country and device codes");
  let target:URL;
  try {target=new URL(incident.targetUrl);}catch {throw new Error("Invalid target URL");}
  if(target.protocol!=="https:"||target.hostname.toLowerCase()!==input.primaryHost.toLowerCase()||
    target.username||target.password||target.port||target.hash||
    !incident.targetUrl.startsWith(request.siteUrl))
    throw new Error("Ranking target is outside the exact storefront property");
  const observed=new Date(incident.observedAt);
  if(typeof incident.observedAt!=="string"||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(incident.observedAt)||
    !Number.isFinite(observed.getTime())||
    observed.getTime()>now.getTime())
    throw new Error("Invalid or future incident timestamp");
  const day=pacificDay(observed),baselineStart=shift(day,-7),priorStart=shift(day,-14),end=shift(day,7);
  // Preserve the original 15-day export while supporting a 22-day pretrend
  // sensitivity check. Do not accept arbitrary windows selected after seeing
  // results, and never use the incident date in either comparison.
  const extended=request.startDate===priorStart;
  const start=extended?priorStart:baselineStart;
  if(end>shift(pacificDay(now),-3))
    throw new Error("GSC followup window is too recent to evaluate as finalized");
  if(request.startDate!==start||request.endDate!==end||
    !Array.isArray(request.dimensions)||request.dimensions.length!==1||
    request.dimensions[0]!=="date"||request.type!=="web"||
    request.dataState!=="final"||
    !["auto","byPage"].includes(request.aggregationType)||
    (request.startRow!==undefined&&request.startRow!==0)||
    (request.rowLimit!==undefined&&(!Number.isInteger(request.rowLimit)||request.rowLimit<(extended?22:15)||request.rowLimit>25000)))
    throw new Error("Expected finalized, date-only GSC data for the fixed 15-day or 22-day window");
  const groups=request.dimensionFilterGroups;
  if(!Array.isArray(groups)||groups.length!==1||groups[0]?.groupType!=="and"||
    !Array.isArray(groups[0].filters)||groups[0].filters.length!==4)
    throw new Error("Expected exact query/page/country/device GSC filters");
  const expected=new Map<string,string>([
    ["query",incident.keyword],["page",incident.targetUrl],
    ["country",incident.country],["device",incident.device]
  ]);
  for(const filter of groups[0].filters){
    if(!filter||filter.operator!=="equals"||!expected.has(filter.dimension)||
      expected.get(filter.dimension)!==filter.expression)
      throw new Error("GSC filters do not match the SERP incident");
    expected.delete(filter.dimension);
  }
  if(expected.size)throw new Error("Missing GSC incident filter");
  if(response.responseAggregationType!=="byPage")
    throw new Error("Page-filtered evidence must use GSC byPage aggregation");
  const rows=parseSearchConsoleRows(response.rows===undefined?[]:response.rows,start,end);
  if(rows.length>(extended?22:15))throw new Error("Too many GSC reporting dates");
  const prior=extended?rows.filter(row=>row.date>=priorStart&&row.date<baselineStart):[];
  const before=rows.filter(row=>row.date>=baselineStart&&row.date<day);
  const after=rows.filter(row=>row.date>day&&row.date<=end);
  const priorBaseline=summarize(prior),baseline=summarize(before),followup=summarize(after);
  const complete=before.length===7&&after.length===7;
  // Screening thresholds, NOT statistical significance. A handful of clicks
  // can produce dramatic percentages with little merchant consequence.
  // Preserve raw counts so reviewers can still inspect sparse cohorts.
  const sufficientVolume=complete&&baseline.clicks>=10&&
    baseline.impressions>=100&&followup.impressions>=100;
  const evidenceStatus=!complete?"incomplete_dates":
    !sufficientVolume?"low_volume":"descriptive_only";
  const pct=(a:number,b:number)=>b>0?(a-b)/b*100:null;
  const priorComplete=extended&&prior.length===7&&before.length===7;
  const priorVolume=priorComplete&&priorBaseline.clicks>=10&&
    priorBaseline.impressions>=100&&baseline.impressions>=100;
  const pretrendStatus=!extended?"not_requested":
    !priorComplete?"incomplete_dates":!priorVolume?"low_volume":"descriptive_only";
  return {
    incidentPacificDate:day,completeDateCoverage:complete,
    missingBaselineDates:7-before.length,missingFollowupDates:7-after.length,
    evidenceStatus,sufficientVolume,
    // Raw changes are still descriptive, not attributed to the ranking event.
    absoluteClicksChange:complete?followup.clicks-baseline.clicks:null,
    absoluteImpressionsChange:complete?followup.impressions-baseline.impressions:null,
    baseline,followup,
    // The earlier seven days reveal whether the baseline was already moving.
    // This is a sensitivity check, not a counterfactual or causal estimate.
    pretrend:{
      status:pretrendStatus,
      completeDateCoverage:priorComplete,
      missingPriorDates:extended?7-prior.length:null,
      priorBaseline:extended?priorBaseline:null,
      absoluteClicksChange:priorComplete?baseline.clicks-priorBaseline.clicks:null,
      absoluteImpressionsChange:priorComplete?baseline.impressions-priorBaseline.impressions:null,
      clicksChangePct:priorVolume?pct(baseline.clicks,priorBaseline.clicks):null,
      impressionsChangePct:priorVolume?pct(baseline.impressions,priorBaseline.impressions):null
    },
    clicksChangePct:sufficientVolume?pct(followup.clicks,baseline.clicks):null,
    impressionsChangePct:sufficientVolume?pct(followup.impressions,baseline.impressions):null,
    avgPositionChange:complete&&baseline.avgPosition!==null&&followup.avgPosition!==null
      ?followup.avgPosition-baseline.avgPosition:null,
    caveat:"Retrospective, descriptive GSC comparison only. The incident day is excluded. Missing query-level rows are unknown, not zero; privacy filtering, top-row limits, seasonality, query demand, and canonical URL differences can bias comparisons. Complete dates do not prove complete query coverage. Percentage changes are withheld when baseline clicks are below 10 or either window has fewer than 100 impressions; these are conservative screening thresholds, not significance tests. GSC Pacific dates and impression-weighted positions are not point-in-time UTC SERP ranks. Optional 22-day exports expose the seven-day pre-incident trend; an already-declining baseline makes a post-incident drop especially hard to attribute. No causal attribution, verified ranking incident, revenue or SEO lift is inferred."
  };
}
