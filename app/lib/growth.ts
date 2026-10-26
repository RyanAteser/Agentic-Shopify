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
function bucket(metrics:OrganicMetric[],from:string,to:string){
  const rows=metrics.filter(x=>x.date>=from&&x.date<=to);
  const clicks=rows.reduce((sum,x)=>sum+x.clicks,0),impressions=rows.reduce((sum,x)=>sum+x.impressions,0);
  const weighted=impressions?rows.reduce((sum,x)=>sum+x.position*x.impressions,0)/impressions:null;
  return {days:rows.length,clicks,impressions,ctr:impressions?clicks/impressions:0,avgPosition:weighted};
}
export function compareOrganicWindows(metrics:OrganicMetric[],now=new Date()):WindowResult {
  // Search Console observations typically lag: exclude three most recent UTC days.
  const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-3));
  const prevEnd=new Date(end.getTime()-28*86400000);
  const currFrom=new Date(end.getTime()-27*86400000);
  const prevFrom=new Date(end.getTime()-55*86400000);
  const current=bucket(metrics,toYMD(currFrom),toYMD(end));
  const previous=bucket(metrics,toYMD(prevFrom),toYMD(prevEnd));
  const comparable=current.days>=21&&previous.days>=21;
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
