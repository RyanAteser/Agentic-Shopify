import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import db from "../app/db.server";
import {queueSwarmResearch,loadSwarmTeam} from "../app/lib/swarm-roster.server";
import {captureVerifiedShopifySnapshot} from "../app/lib/swarm-evidence.server";
import {executeSingleAgentBenchmark,BENCHMARK_SENDER} from "../app/lib/swarm-benchmark.server";
import {executeBoundedSwarmCase} from "../app/lib/swarm-executor.server";
import {BENCHMARK_CASES,benchmarkBrief,scoreBenchmarkCase} from "../app/lib/swarm-benchmark-policy";
import {geminiBoundedProvider} from "../app/lib/swarm-gemini.server";

async function main(){
  const mode=process.argv.slice(2).join(" ");
  if(!["--run-frozen-two-case-evaluation","--run-second-case-only"].includes(mode)){
    throw new Error("Usage: --run-frozen-two-case-evaluation or --run-second-case-only");
  }
  const selectedCases=mode==="--run-second-case-only"?
    BENCHMARK_CASES.slice(1):BENCHMARK_CASES;
  const env=process.env;
  const shop=env.SWARM_WORKER_ALLOWED_SHOP;
  if(!shop||env.SWARM_BENCHMARK_ENABLED!=="true"||
     env.SWARM_ENABLE_PAID_MODEL_CALLS!=="true"||
     env.SWARM_WORKER_ENABLED!=="true"||env.SWARM_EXECUTION_ENABLED!=="true"){
    throw new Error("Explicitly approved owner benchmark flags are required.");
  }
  const provider=geminiBoundedProvider();
  const session=await db.session.findFirst({where:{shop,isOnline:false},
    select:{id:true,accessToken:true,scope:true,expires:true}});
  if(!session||session.expires&&session.expires<new Date()||
     !session.scope?.split(",").includes("read_products")){
    throw new Error("Shopify read-only dev-store session is missing or expired.");
  }
  const {participants}=await loadSwarmTeam(shop);
  if(participants.totalSpecialists!==2||participants.totalSkeptics!==1){
    throw new Error("Exactly two specialists and one skeptic required.");
  }
  const admin={graphql:async(query:string)=>{
    const response=await fetch("https://"+shop+"/admin/api/2026-10/graphql.json",{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(12_000),
      headers:{"X-Shopify-Access-Token":session.accessToken,
        "Content-Type":"application/json"},body:JSON.stringify({query})
    });
    if(!response.ok)throw new Error("Authenticated Shopify evidence request failed.");
    return {json:()=>response.json() as Promise<unknown>};
  }};
  const snapshot=await captureVerifiedShopifySnapshot(admin,shop);
  if(snapshot.allProductsHasNextPage||snapshot.publishedProductsHasNextPage){
    throw new Error("Benchmark selected for fully observed bounded catalog only.");
  }
  const usage=await db.swarmUsageMonth.findUnique({where:{shop_month:{
    shop,month:snapshot.collectedAt.slice(0,7)
  }}});
  // Each paired comparison uses 1 baseline + 6 swarm requests.
  if((usage?.reserved??0)+(usage?.consumed??0)+selectedCases.length*7>25)
    throw new Error("The existing 25-unit monthly model-request cap cannot fit the full A/B run.");

  for(const spec of selectedCases){
    if(await db.swarmCase.count({where:{shop,title:spec.question}})){
      throw new Error("This preregistered benchmark question already has an attempt; do not duplicate.");
    }
  }
  const referenceDigest=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const results:unknown[]=[];
  const started=Date.now();
  for(const spec of selectedCases){
    const brief=benchmarkBrief(spec);
    // Both arms receive the SAME frozen verified fact snapshot and task brief.
    const single=await queueSwarmResearch({shop,sessionId:session.id,role:"seo",
      plan:"free",...brief,trustedSnapshot:snapshot});
    const swarm=await queueSwarmResearch({shop,sessionId:session.id,role:"seo",
      plan:"free",...brief,trustedSnapshot:snapshot});
    const baselineResult=await executeSingleAgentBenchmark({
      shop,caseId:single.id,provider,env
    });
    if(baselineResult.status!=="completed"){
      throw new Error("Baseline outcome uncertain: stop before initiating the swarm.");
    }
    const swarmResult=await executeBoundedSwarmCase({
      shop,caseId:swarm.id,provider,env
    });
    if(swarmResult.status!=="completed"){
      throw new Error("Swarm outcome uncertain: stop without launching another case.");
    }
    const [b,s]=await Promise.all([
      db.swarmMessage.findFirst({where:{shop,caseId:single.id,senderId:BENCHMARK_SENDER},
        select:{body:true}}),
      db.swarmMessage.findFirst({where:{shop,caseId:swarm.id,kind:"verdict"},
        select:{body:true,verdict:true}})
    ]);
    if(!b||!s)throw new Error("Benchmark was missing committed final model messages.");
    const grade=scoreBenchmarkCase({
      spec,facts:snapshot,singleAnswer:b.body,swarmAnswer:s.body,
      singleTokens:{input:baselineResult.inputTokens,output:baselineResult.outputTokens},
      swarmTokens:{input:swarmResult.inputTokens,output:swarmResult.outputTokens}
    });
    results.push({
      ...grade,caseIds:{single:single.id,swarm:swarm.id},
      operationalSkepticVerdict:s.verdict,
      calls:{single:1,swarm:6}
    });
    // These cases are benchmark artifacts, not permanent open workflow jobs.
    await db.swarmCase.updateMany({where:{
      shop,id:{in:[single.id,swarm.id]},status:"needs_evidence"
    },data:{status:"benchmark_evaluated"}});
    // Only safe aggregated results are emitted; no private product payloads,
    // credentials, model transcripts or unverified citation contents.
    process.stdout.write(JSON.stringify({case:spec.id,expected:grade.expected,
      singleAnswer:grade.single.answer,swarmAnswer:grade.swarm.answer,
      singleCorrect:grade.single.correct,swarmCorrect:grade.swarm.correct,
      singleTokens:grade.single.inputTokens+grade.single.outputTokens,
      swarmTokens:grade.swarm.inputTokens+grade.swarm.outputTokens,
      operationalSkepticVerdict:s.verdict})+"\n");
  }
  const report={kind:"owner_only_exploratory_grounded_ab",shop,model:provider.modelName,
    snapshotDigest:referenceDigest,snapshotObservedAt:snapshot.collectedAt,
    benchmarkCaseCount:selectedCases.length,elapsedMs:Date.now()-started,
    results,conclusion:"Too few cases to infer swarm superiority, SEO gains or production ROI."};
  const local=env.LOCALAPPDATA;
  if(local){
    const folder=join(local,"AgenticShopify","Evaluations");
    await mkdir(folder,{recursive:true});
    const target=join(folder,"swarm-ab-20261106-"+Date.now()+".json");
    await writeFile(target,JSON.stringify(report,null,2),{encoding:"utf8",flag:"wx",mode:0o600});
    process.stdout.write("LOCAL_REPORT_SAVED=true\n");
  }
  const aggregate=(results as Array<{single:{correct:boolean;illustrativePaidUsd:number};
    swarm:{correct:boolean;illustrativePaidUsd:number}}>);
  process.stdout.write(JSON.stringify({completedCases:aggregate.length,
    singleCorrect:aggregate.filter(x=>x.single.correct).length,
    swarmCorrect:aggregate.filter(x=>x.swarm.correct).length,
    singleEstimatedUsd:aggregate.reduce((t,x)=>t+x.single.illustrativePaidUsd,0),
    swarmEstimatedUsd:aggregate.reduce((t,x)=>t+x.swarm.illustrativePaidUsd,0),
    pricingBasis:"Published paid-tier token rates, NOT Google invoice",
    limitations:report.conclusion})+"\n");
}
main().catch(e=>{
  // Never print provider response bodies or dev-shop access tokens.
  process.stderr.write("Benchmark stopped: "+(e instanceof Error?e.name:"UnknownError")+"\n");
  process.exitCode=1;
}).finally(()=>db.$disconnect());
