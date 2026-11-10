import db from "../db.server";
import type {WorkerBlogUsageEvidence} from "./provider-usage-reconciliation";

/**
 * Read-only exact-shop UTC job-created cohort.
 * Does NOT claim the worker receipt was provider-verified or billed.
 */
export async function loadBlogUsageForCohort(
  shop:string,month:string
):Promise<WorkerBlogUsageEvidence[]>{
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||
     !/^(20[2-9]\d)-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Exact tenant and YYYY-MM UTC cohort required");
  const [year,m]=month.split("-").map(Number);
  const bounds={gte:new Date(Date.UTC(year,m-1,1)),
    lt:new Date(Date.UTC(year,m,1))};
  const jobs=await db.contentJob.findMany({
    where:{shop,createdAt:bounds},take:2000,
    select:{id:true}
  });
  if(jobs.length===2000)throw new Error("Cohort exceeds 1,999 jobs, paginate before audit");
  if(!jobs.length)return [];
  const rows=await db.blogGenerationUsage.findMany({
    where:{shop,jobId:{in:jobs.map(x=>x.id)}},
    take:4000,
    select:{shop:true,jobId:true,stage:true,provider:true,model:true,
      inputTokens:true,outputTokens:true,responseIdHash:true}
  });
  if(rows.length===4000)throw new Error("Cohort exceeds 3,999 usage receipts");
  return rows;
}
