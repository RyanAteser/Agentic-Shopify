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
  if(typeof incident.observedAt!=="string"||!Number.isFinite(observed.getTime())||
    observed.getTime()>now.getTime())
    throw new Error("Invalid or future incident timestamp");
  const day=pacificDay(observed),start=shift(day,-7),end=shift(day,7);
  if(request.startDate!==start||request.endDate!==end||
    !Array.isArray(request.dimensions)||request.dimensions.length!==1||
    request.dimensions[0]!=="date"||request.type!=="web"||
    request.dataState!=="final"||
    !["auto","byPage"].includes(request.aggregationType)||
    (request.startRow!==undefined&&request.startRow!==0)||
    (request.rowLimit!==undefined&&(!Number.isInteger(request.rowLimit)||request.rowLimit<15)))
    throw new Error("Expected finalized, date-only GSC data for the fixed 15-day window");
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
  if(rows.length>15)throw new Error("Too many GSC reporting dates");
  const before=rows.filter(row=>row.date>=start&&row.date<day);
  const after=rows.filter(row=>row.date>day&&row.date<=end);
  const baseline=summarize(before),followup=summarize(after);
  const complete=before.length===7&&after.length===7;
  const pct=(a:number,b:number)=>b>0?(a-b)/b*100:null;
  return {
    incidentPacificDate:day,completeDateCoverage:complete,
    missingBaselineDates:7-before.length,missingFollowupDates:7-after.length,
    baseline,followup,
    clicksChangePct:complete?pct(followup.clicks,baseline.clicks):null,
    impressionsChangePct:complete?pct(followup.impressions,baseline.impressions):null,
    avgPositionChange:complete&&baseline.avgPosition!==null&&followup.avgPosition!==null
      ?followup.avgPosition-baseline.avgPosition:null,
    caveat:"Retrospective, descriptive GSC comparison only. The incident day is excluded. Missing query-level rows are unknown, not zero; privacy filtering, top-row limits, seasonality, query demand, and canonical URL differences can bias comparisons. Complete dates do not prove complete query coverage. GSC Pacific dates and impression-weighted positions are not point-in-time UTC SERP ranks. No causal attribution, verified ranking incident, revenue or SEO lift is inferred."
  };
}
