import db from "../db.server";
import type {ObservedUsage} from "./unit-economics";

function monthBounds(month:string){
  if(!/^(20[2-9]\d)-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Expected a YYYY-MM reporting month");
  const [year,m]=month.split("-").map(Number);
  return {gte:new Date(Date.UTC(year,m-1,1)),lt:new Date(Date.UTC(year,m,1))};
}
/** Aggregate only one explicitly authorized merchant and one UTC month. */
export async function loadObservedUsage(shop:string,month:string):Promise<ObservedUsage>{
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
    throw new Error("Invalid exact merchant identifier");
  const window=monthBounds(month);
  const [invocations,jobs,drafts,published,reviews,ranks]=await Promise.all([
    db.swarmInvocation.findMany({where:{shop,createdAt:window},take:10000,
      select:{executionId:true,status:true,inputTokens:true,outputTokens:true}}),
    db.contentJob.findMany({where:{shop,createdAt:window},take:2000,select:{id:true}}),
    db.articleDraft.count({where:{shop,createdAt:window}}),
    db.articleDraft.count({where:{shop,publishedAt:window}}),
    db.editorialReview.findMany({where:{shop,reviewedAt:window},take:10000,
      select:{reviewMinutes:true}}),
    db.seoRankObservation.count({where:{shop,receivedAt:window}})
  ]);
  // Call/price estimates must never silently ignore a truncated dataset.
  if(invocations.length===10000||reviews.length===10000||jobs.length===2000)
    throw new Error("Monthly audit exceeds 10,000 records; paginate before financial reporting");
  const ids=[...new Set(invocations.map(i=>i.executionId))];
  const executions=ids.length?await db.swarmExecution.findMany({
    where:{shop,id:{in:ids}},select:{id:true,provider:true,model:true}
  }):[];
  const models=new Map(executions.map(x=>[x.id,x]));
  const blogRows=jobs.length?await db.blogGenerationUsage.findMany({
    where:{shop,jobId:{in:jobs.map(j=>j.id)}},take:4000,
    select:{jobId:true,stage:true,provider:true,model:true,inputTokens:true,outputTokens:true}
  }):[];
  if(blogRows.length===4000)throw new Error("Blog usage exceeds 4,000 rows; paginate before financial reporting");
  const stageByJob=new Map<string,Set<string>>();
  for(const row of blogRows){
    const found=stageByJob.get(row.jobId)||new Set<string>();
    found.add(row.stage);stageByJob.set(row.jobId,found);
  }
  const completeBlogJobs=[...stageByJob.values()].filter(x=>x.has("writer")&&x.has("editor")).length;
  const blogUsageReceipts=blogRows.map(r=>({
    provider:r.provider,model:r.model,status:"committed",
    inputTokens:r.inputTokens,outputTokens:r.outputTokens
  }));
  const calls=invocations.map(i=>{
    const model=models.get(i.executionId);
    if(!model)throw new Error("Invocation lacks tenant-verified model lineage");
    return {provider:model.provider,model:model.model,status:i.status,
      inputTokens:i.inputTokens,outputTokens:i.outputTokens};
  });
  const actualMinutes=reviews.filter(x=>x.reviewMinutes!==null).map(x=>x.reviewMinutes!);
  return {
    shop,month,invocations:calls,blogUsageReceipts,completeBlogJobs,
    generationJobs:jobs.length,drafts,publishedDrafts:published,
    editorialDecisions:reviews.length,
    reviewMinutesTotal:actualMinutes.reduce((sum,n)=>sum+n,0),
    reviewMinutesReported:actualMinutes.length,
    rankingSnapshots:ranks
  };
}
