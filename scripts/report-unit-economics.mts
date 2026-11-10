/**
 * Owner-only command. No Shopify/Google/n8n calls, no merchant writes.
 * Example:
 * node --import tsx scripts/report-unit-economics.mts \
 *   --shop consenting-shop.myshopify.com --month 2026-11 \
 *   --assumptions docs/profit-scenario.example.json
 */
import {readFileSync} from "node:fs";
import {loadObservedUsage} from "../app/lib/unit-economics.server";
import {allowableServiceSpend,evaluatePlan,PLAN_SCENARIOS,type ObservedUsage,type ScenarioAssumptions} from "../app/lib/unit-economics";

function args(argv:string[]){
  if(argv.length%2!==0||argv.length<4)throw new Error(
    "Usage: --shop exact.myshopify.com --month YYYY-MM [--assumptions file.json]");
  const pairs=new Map<string,string>();
  for(let i=0;i<argv.length;i+=2){
    if(!["--shop","--month","--assumptions"].includes(argv[i])||
       pairs.has(argv[i])||!argv[i+1])throw new Error("Unsupported or duplicate flag");
    pairs.set(argv[i],argv[i+1]);
  }
  if(!pairs.has("--shop")||!pairs.has("--month"))throw new Error("Exact shop and month required");
  return pairs;
}
async function main(){
  const a=args(process.argv.slice(2));
  const usage:ObservedUsage=await loadObservedUsage(a.get("--shop")!,a.get("--month")!);
  const report:Record<string,unknown>={
    status:"owner_read_only_observation",
    source:"tenant-scoped SQLite or PostgreSQL local database; no provider invoices",
    shop:usage.shop,month:usage.month,
    observed:{
      attemptedModelCalls:usage.invocations.length,
      workerReportedBlogCalls:usage.blogUsageReceipts.length,
      blogJobsWithCompleteWorkerUsage:usage.completeBlogJobs,
      blogJobsMissingCompleteWorkerUsage:usage.generationJobs-usage.completeBlogJobs,
      committedModelCalls:usage.invocations.filter(x=>x.status==="committed").length,
      unverifiedModelCalls:usage.invocations.filter(x=>x.status!=="committed").length,
      observedInputTokens:[...usage.invocations,...usage.blogUsageReceipts].reduce((s,x)=>s+x.inputTokens,0),
      observedOutputTokens:[...usage.invocations,...usage.blogUsageReceipts].reduce((s,x)=>s+x.outputTokens,0),
      generationJobs:usage.generationJobs,
      drafts:usage.drafts,publishedDrafts:usage.publishedDrafts,
      editorialDecisions:usage.editorialDecisions,
      reviewMinutesReported:usage.reviewMinutesReported,
      reviewMinutesTotal:usage.reviewMinutesTotal,
      rankingSnapshots:usage.rankingSnapshots,
    },
    actualNetProfit:null,
    reason:"No actual subscription payout, vendor invoice, licensing allocation or support payroll reconciliation."
  };
  if(a.has("--assumptions")){
    const path=a.get("--assumptions")!;
    const raw=readFileSync(path,"utf8");
    if(raw.length>100000)throw new Error("Scenario assumptions too large");
    const assumptions=JSON.parse(raw) as ScenarioAssumptions;
    report.projections=Object.fromEntries(
      (Object.keys(PLAN_SCENARIOS) as (keyof typeof PLAN_SCENARIOS)[]).map(plan=>
        [plan,evaluatePlan(plan,usage,assumptions)])
    );
    report.budgetCaps70Pct=Object.fromEntries(
      (Object.keys(PLAN_SCENARIOS) as (keyof typeof PLAN_SCENARIOS)[]).map(plan=>
        [plan,allowableServiceSpend(plan,{
          targetContributionMarginPct:70,processingRate:assumptions.processingRate,
          revenueShareRate:assumptions.revenueShareRate
        })])
    );
    report.projectionStatus="hypothetical tier sensitivity; NOT invoices or realized merchant subscriptions";
  }
  console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error("Unit-economics report aborted:",e instanceof Error?e.message:"unknown");process.exitCode=1;});
