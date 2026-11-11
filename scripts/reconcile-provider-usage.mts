/**
 * Operator-only offline reconciliation:
 *   node --import tsx scripts/reconcile-provider-usage.mts \
 *     --shop consenting.myshopify.com --month 2026-11 \
 *     --provider-export /private/openai-request-usage.json \
 *     [--billing-extract /private/openai-account-billing.json]
 *
 * No provider API calls, no merchant writes, no billing changes.
 * Never output raw request IDs, provider API credentials or file contents.
 */
import {readFileSync,statSync} from "node:fs";
import {loadBlogUsageForCohort} from "../app/lib/provider-usage-reconciliation.server";
import {loadObservedUsage} from "../app/lib/unit-economics.server";
import {reconcileBlogProviderUsage} from "../app/lib/provider-usage-reconciliation";
import db from "../app/db.server";

function cli(argv:string[]){
  if(argv.length<6||argv.length>8||argv.length%2!==0)
    throw new Error("Expected --shop --month --provider-export [--billing-extract]");
  const args=new Map<string,string>();
  for(let i=0;i<argv.length;i+=2){
    const flag=argv[i],value=argv[i+1];
    if(!["--shop","--month","--provider-export","--billing-extract"].includes(flag)||
       args.has(flag)||!value||value.startsWith("--"))
      throw new Error("Unknown, missing or duplicate reconciliation argument");
    args.set(flag,value);
  }
  if(!args.get("--shop")||!args.get("--month")||!args.get("--provider-export"))
    throw new Error("Exact shop, month and provider export are mandatory");
  return args;
}
function safeRead(path:string):unknown{
  // Never log raw file paths, content, provider IDs or credential material.
  // Check file size BEFORE allocating a buffer for an untrusted export.
  try {
    const stat=statSync(path);
    if(!stat.isFile()||stat.size>2_000_000)
      throw new Error("Export is not a bounded local file");
    return JSON.parse(readFileSync(path,"utf8"));
  } catch {
    throw new Error("Cannot safely read normalized private export; verify file type, 2MB size and JSON format");
  }
}
async function main(){
  const args=cli(process.argv.slice(2));
  const shop=args.get("--shop")!,month=args.get("--month")!;
  const [worker,observed]=await Promise.all([
    loadBlogUsageForCohort(shop,month),loadObservedUsage(shop,month)
  ]);
  const requestExport=safeRead(args.get("--provider-export")!);
  const invoice=args.has("--billing-extract")?
    safeRead(args.get("--billing-extract")!):undefined;
  const result=reconcileBlogProviderUsage(shop,month,worker,requestExport,invoice);
  console.log(JSON.stringify({
    reportType:"operator_supplied_provider_request_crosscheck",
    result,
    cohort:{
      jobs:observed.generationJobs,
      jobsWithBothWorkerStages:observed.completeBlogJobs,
      jobsMissingCompleteWorkerUsage:
        observed.generationJobs-observed.completeBlogJobs
    },
    notice:"No merchant actual profit, paid entitlements, fee reconciliation or vendor invoice authentication established."
  },null,2));
}
main().catch(error=>{
  // No response IDs, input file paths or model payloads in output.
  console.error("Reconciliation refused:",error instanceof Error?error.message:"unknown error");
  process.exitCode=1;
}).finally(()=>db.$disconnect());
