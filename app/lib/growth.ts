/** Organic Search Console analytics: descriptive comparison only, never causal attribution. */
export type OrganicMetric={date:string;clicks:number;impressions:number;ctr:number;position:number};
export function parseSearchConsoleRows(rows:unknown, start:string, end:string):OrganicMetric[] {
  if(!Array.isArray(rows))throw new Error("Expected Google Search Console rows array");
  const seen=new Set<string>();
  const output:OrganicMetric[]=[];
  for(const x of rows){
    if(!x||typeof x!=="object")throw new Error("Invalid Google metric row");
    const r=x as Record<string,unknown>;
    const keys=r.keys;
    const date=Array.isArray(keys)?keys[0]:undefined;
    if(typeof date!=="string"||!/^\d{4}-\d\d-\d\d$/.test(date)||date<start||date>end||seen.has(date)) {
      throw new Error("Unexpected, out-of-range or duplicate Google metric date");
    }
    seen.add(date);
    const clicks=Number(r.clicks),impressions=Number(r.impressions),
      ctr=Number(r.ctr),position=Number(r.position);
    if(![clicks,impressions,ctr,position].every(Number.isFinite)||
      clicks<0||impressions<0||clicks>impressions||ctr<0||ctr>1||position<0||position>500){
      throw new Error("Invalid organic metric values");
    }
    output.push({date,clicks,impressions,ctr,position});
  }
  return output;
}

export type WindowResult={
  current:{days:number;clicks:number;impressions:number;ctr:number;avgPosition:number|null};
  previous:{days:number;clicks:number;impressions:number;ctr:number;avgPosition:number|null};
  clicksChangePct:number|null;impressionsChangePct:number|null;comparable:boolean;
};
const toYMD=(day:Date)=>day.toISOString().slice(0,10);
const DAY_MS=86400000;
/** Google Search Console date boundaries are Pacific calendar dates, including DST. */
export function gscReportingWindow(now=new Date()){
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(now);
  const dateParts=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const pacificDay=Date.UTC(Number(dateParts.year),Number(dateParts.month)-1,Number(dateParts.day));
  return {
    startDate:toYMD(new Date(pacificDay-58*DAY_MS)),
    endDate:toYMD(new Date(pacificDay-3*DAY_MS))
  };
}
function bucket(metrics:OrganicMetric[],from:string,to:string){
  const rows=metrics.filter(x=>x.date>=from&&x.date<=to);
  const clicks=rows.reduce((sum,x)=>sum+x.clicks,0),impressions=rows.reduce((sum,x)=>sum+x.impressions,0);
  const weighted=impressions?rows.reduce((sum,x)=>sum+x.position*x.impressions,0)/impressions:null;
  // API omits dates with no observations. Do not silently treat missing days as zero.
  const days=new Set(rows.map(x=>x.date)).size;
  return {days,clicks,impressions,ctr:impressions?clicks/impressions:0,
    avgPosition:weighted,complete:days===28&&rows.length===28};
}
export function compareOrganicWindows(metrics:OrganicMetric[],now=new Date()):WindowResult {
  // Both imported and compared windows must use Google's Pacific reporting dates.
  const {endDate}=gscReportingWindow(now);
  const end=new Date(endDate+"T00:00:00.000Z");
  const prevEnd=new Date(end.getTime()-28*86400000);
  const currFrom=new Date(end.getTime()-27*86400000);
  const prevFrom=new Date(end.getTime()-55*86400000);
  const current=bucket(metrics,toYMD(currFrom),toYMD(end));
  const previous=bucket(metrics,toYMD(prevFrom),toYMD(prevEnd));
  const comparable=current.complete&&previous.complete;
  const change=(a:number,b:number)=>comparable&&b>0?(a-b)/b*100:null;
  return {current,previous,clicksChangePct:change(current.clicks,previous.clicks),
    impressionsChangePct:change(current.impressions,previous.impressions),comparable};
}
export function matchesPrimaryDomain(siteUrl:string,host:string) {
  const primary=host.trim().toLowerCase().replace(/\.$/,"");
  if(!primary||!primary.includes(".")||primary.includes("/")||primary.includes(":"))return false;
  if(siteUrl.startsWith("sc-domain:")){
    const domain=siteUrl.slice("sc-domain:".length).toLowerCase().replace(/\.$/,"");
    // Limit domain properties to registrable merchant domains, not public suffixes.
    if(domain.split(".").length<2||["com","co.uk","net","org","myshopify.com"].includes(domain))return false;
    return primary===domain||primary.endsWith("."+domain);
  }
  try{
    const url=new URL(siteUrl);
    return url.protocol==="https:" && url.hostname.toLowerCase()===primary &&
      (!url.port || url.port==="443") && url.pathname==="/" && !url.search;
  }catch{return false;}
}
