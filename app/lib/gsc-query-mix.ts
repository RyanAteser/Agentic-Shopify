/** Offline, read-only query-mix diagnostic. Never interpret as causal SEO attribution.
 * Input must be an explicitly consented, matched page/query export. Google may
 * omit anonymized and low-volume queries, so coverage is not guaranteed.
 */
export type QueryPeriod={query:string;clicks:number;impressions:number};
export type QueryMixResult={
  status:"descriptive_only"|"insufficient_coverage";
  matchedQueries:number;newQueries:number;lostQueries:number;
  matchedPreviousImpressions:number;matchedCurrentImpressions:number;
  matchedPreviousClicks:number;matchedCurrentClicks:number;
  previousClicks:number;currentClicks:number;
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
    matchedPreviousClicks:pc,matchedCurrentClicks:cc,
    previousClicks:p.clicks,currentClicks:c.clicks,
    previousImpressions:p.impressions,currentImpressions:c.impressions,
    matchedPreviousCtr:ctr(pc,pi),matchedCurrentCtr:ctr(cc,ci),
    totalPreviousCtr:ctr(p.clicks,p.impressions),totalCurrentCtr:ctr(c.clicks,c.impressions)
  };
}


/** Compare exported query-row totals with a separately requested, identically
 * filtered property-level Search Console total. This is an export completeness
 * check, NOT a guarantee that anonymized queries are observable.
 * Never use an incomplete query cohort for merchant-facing SEO conclusions.
 */
export function assessQueryExportCoverage(
  rows:QueryPeriod[],
  propertyTotal:{clicks:number;impressions:number},
):{status:"usable_for_review"|"incomplete_export";clickCoverage:number|null;impressionCoverage:number|null}{
  if(!propertyTotal||!Number.isSafeInteger(propertyTotal.clicks)||
    !Number.isSafeInteger(propertyTotal.impressions)||propertyTotal.clicks<0||
    propertyTotal.impressions<propertyTotal.clicks)
    throw new Error("Invalid property totals");
  // Reuse duplicate/unsafe-row validation rather than silently double counting.
  const observed=compareQueryMix([],rows);
  const sumClicks=rows.reduce((n,r)=>n+r.clicks,0);
  const sumImpressions=observed.currentImpressions;
  if(sumClicks>propertyTotal.clicks||sumImpressions>propertyTotal.impressions)
    throw new Error("Query export exceeds property totals; filters may differ");
  const ratio=(part:number,total:number)=>total>0?part/total:null;
  const clickCoverage=ratio(sumClicks,propertyTotal.clicks);
  const impressionCoverage=ratio(sumImpressions,propertyTotal.impressions);
  return {status:clickCoverage!==null&&impressionCoverage!==null&&
    clickCoverage>=0.8&&impressionCoverage>=0.8?"usable_for_review":"incomplete_export",
    clickCoverage,impressionCoverage};
}

/** Two-period preflight: prevent a well-covered export from masking a tiny,
 * nonrepresentative matched-query cohort. Advisory research only.
 * The 50% matched-impression and matched-click rules are heuristics, not statistical proof.
 */
export function assessPairedQueryMix(
  previous:QueryPeriod[],current:QueryPeriod[],
  previousTotal:{clicks:number;impressions:number},
  currentTotal:{clicks:number;impressions:number},
):{status:"descriptive_only"|"withheld";reason:"ok"|"export_coverage"|"matched_cohort";
  comparison:QueryMixResult;
  previousCoverage:ReturnType<typeof assessQueryExportCoverage>;
  currentCoverage:ReturnType<typeof assessQueryExportCoverage>}{
  const previousCoverage=assessQueryExportCoverage(previous,previousTotal);
  const currentCoverage=assessQueryExportCoverage(current,currentTotal);
  const comparison=compareQueryMix(previous,current);
  const coverageOk=previousCoverage.status==="usable_for_review"&&
    currentCoverage.status==="usable_for_review";
  const matchedOk=comparison.status==="descriptive_only"&&
    comparison.previousImpressions>0&&comparison.currentImpressions>0&&
    comparison.matchedPreviousImpressions/comparison.previousImpressions>=0.5&&
    comparison.matchedCurrentImpressions/comparison.currentImpressions>=0.5&&
    comparison.previousClicks>0&&comparison.currentClicks>0&&
    comparison.matchedPreviousClicks/comparison.previousClicks>=0.5&&
    comparison.matchedCurrentClicks/comparison.currentClicks>=0.5;
  const reason=!coverageOk?"export_coverage":!matchedOk?"matched_cohort":"ok";
  return {status:reason==="ok"?"descriptive_only":"withheld",reason,
    comparison,previousCoverage,currentCoverage};
}
