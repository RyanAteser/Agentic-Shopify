/** Offline, read-only query-mix diagnostic. Never interpret as causal SEO attribution.
 * Input must be an explicitly consented, matched page/query export. Google may
 * omit anonymized and low-volume queries, so coverage is not guaranteed.
 */
export type QueryPeriod={query:string;clicks:number;impressions:number};
export type QueryMixResult={
  status:"descriptive_only"|"insufficient_coverage";
  matchedQueries:number;newQueries:number;lostQueries:number;
  matchedPreviousImpressions:number;matchedCurrentImpressions:number;
  previousImpressions:number;currentImpressions:number;
  matchedPreviousCtr:number|null;matchedCurrentCtr:number|null;
  totalPreviousCtr:number|null;totalCurrentCtr:number|null;
};
export function compareQueryMix(previous:QueryPeriod[],current:QueryPeriod[]):QueryMixResult {
  const read=(rows:QueryPeriod[])=>{
    const seen=new Set<string>();let impressions=0,clicks=0;
    for(const row of rows){
      if(!row||typeof row.query!=="string"||!row.query.trim()||seen.has(row.query)||
        !Number.isSafeInteger(row.clicks)||!Number.isSafeInteger(row.impressions)||
        row.clicks<0||row.impressions<row.clicks)throw new Error("Invalid or duplicate query observation");
      seen.add(row.query);clicks+=row.clicks;impressions+=row.impressions;
      if(!Number.isSafeInteger(clicks)||!Number.isSafeInteger(impressions))
        throw new Error("Unsafe aggregate");
    }
    return {map:new Map(rows.map(r=>[r.query,r])),clicks,impressions};
  };
  const p=read(previous),c=read(current);
  let pc=0,pi=0,cc=0,ci=0,matched=0;
  for(const [query,a] of p.map){
    const b=c.map.get(query);
    if(!b)continue;
    matched++;pc+=a.clicks;pi+=a.impressions;cc+=b.clicks;ci+=b.impressions;
  }
  if([pc,pi,cc,ci].some(n=>!Number.isSafeInteger(n)))throw new Error("Unsafe matched aggregate");
  const ctr=(clicks:number,impressions:number)=>impressions>0?clicks/impressions:null;
  return {
    // A descriptive matched cohort is available only if both periods have
    // enough exposure. These are screening thresholds, not significance tests.
    status:matched>=5&&pi>=100&&ci>=100?"descriptive_only":"insufficient_coverage",
    matchedQueries:matched,newQueries:c.map.size-matched,lostQueries:p.map.size-matched,
    matchedPreviousImpressions:pi,matchedCurrentImpressions:ci,
    previousImpressions:p.impressions,currentImpressions:c.impressions,
    matchedPreviousCtr:ctr(pc,pi),matchedCurrentCtr:ctr(cc,ci),
    totalPreviousCtr:ctr(p.clicks,p.impressions),totalCurrentCtr:ctr(c.clicks,c.impressions)
  };
}
