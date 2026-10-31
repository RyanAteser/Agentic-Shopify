/** Offline diagnostic: separate within-query CTR changes from shifts in the
 * impression mix of returning queries. This is descriptive, not causal.
 * Do not use without assessPairedQueryMix's independent coverage preflight.
 */
import {assessPairedQueryMix, type QueryPeriod} from "./gsc-query-mix";

export type FixedMixResult =
  | {status:"withheld";reason:"invalid_rows"|"insufficient_matched_exposure"|"zero_current_exposure"}
  | {status:"descriptive_only";matchedQueries:number;previousCtr:number;currentCtr:number;
      fixedPreviousMixCurrentCtr:number;withinQueryEffect:number;mixEffect:number};

/** Previous-period impression shares are held fixed when evaluating current
 * query CTRs. If a returning query has no current impressions, its current
 * CTR is unobserved and the diagnostic abstains rather than imputing zero.
 */
export function compareFixedQueryMix(previous:QueryPeriod[],current:QueryPeriod[]):FixedMixResult {
  const parse=(rows:QueryPeriod[])=>{
    const m=new Map<string,QueryPeriod>();
    for(const r of rows){
      if(!r||typeof r.query!=="string"||!r.query.trim()||m.has(r.query)||
        !Number.isSafeInteger(r.clicks)||!Number.isSafeInteger(r.impressions)||
        r.clicks<0||r.impressions<r.clicks)throw new Error("Invalid or duplicate query observation");
      m.set(r.query,r);
    }
    return m;
  };
  const p=parse(previous),c=parse(current);
  let n=0,pi=0,pc=0,ci=0,cc=0,weighted=0;
  for(const [key,a] of p){
    const b=c.get(key);if(!b)continue;
    n++;
    if(a.impressions===0||b.impressions===0)
      return {status:"withheld",reason:"zero_current_exposure"};
    pi+=a.impressions;pc+=a.clicks;ci+=b.impressions;cc+=b.clicks;
    weighted+=a.impressions*(b.clicks/b.impressions);
    if(![pi,pc,ci,cc].every(Number.isSafeInteger)||!Number.isFinite(weighted))
      throw new Error("Unsafe aggregate");
  }
  if(n<5||pi<100||ci<100)return {status:"withheld",reason:"insufficient_matched_exposure"};
  const previousCtr=pc/pi,currentCtr=cc/ci,fixedPreviousMixCurrentCtr=weighted/pi;
  return {status:"descriptive_only",matchedQueries:n,previousCtr,currentCtr,
    fixedPreviousMixCurrentCtr,
    withinQueryEffect:fixedPreviousMixCurrentCtr-previousCtr,
    mixEffect:currentCtr-fixedPreviousMixCurrentCtr};
}


/** Safe entry point for research consumers. Unlike compareFixedQueryMix,
 * this function enforces independent property-total and matched-cohort
 * coverage checks before exposing any CTR effects. Withheld results never
 * contain numeric effects that could be accidentally shown as advice.
 */
export function assessFixedQueryMix(
  previous:QueryPeriod[],current:QueryPeriod[],
  previousTotal:{clicks:number;impressions:number},
  currentTotal:{clicks:number;impressions:number},
): {status:"withheld";reason:"export_coverage"|"matched_cohort"|"invalid_rows"|"insufficient_matched_exposure"|"zero_current_exposure"} |
   Extract<FixedMixResult,{status:"descriptive_only"}> {
  // Untrusted or mismatched exports must abstain, not crash an advisory
  // consumer or leak partially calculated CTR effects. Only known validation
  // errors are translated; unexpected programming errors still surface.
  try {
    const preflight=assessPairedQueryMix(previous,current,previousTotal,currentTotal);
    if(preflight.status==="withheld")return {status:"withheld",
      reason:preflight.reason==="export_coverage"?"export_coverage":"matched_cohort"};
    return compareFixedQueryMix(previous,current);
  } catch(error) {
    if(error instanceof Error && /^(Invalid or duplicate query observation|Unsafe (aggregate|matched aggregate)|Invalid property totals|Query export exceeds property totals)/.test(error.message))
      return {status:"withheld",reason:"invalid_rows"};
    throw error;
  }
}
