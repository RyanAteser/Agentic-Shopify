import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {EVALUATION_CASES,EVALUATION_DIGEST,auditOfflineRouter}
  from "../app/lib/swarm-evaluation-30";
import {blindEvaluationPacket,evaluateThirty}
  from "../app/lib/swarm-eval-scoring";

/**
 * Deliberately OFFLINE ONLY. Does not load provider credentials, connect to
 * Shopify, create research cases, reserve credits or call model APIs.
 */
async function main(){
  const [mode,inputFile,...other]=process.argv.slice(2);
  if(!["--offline","--packet","--score"].includes(mode??"")||
    other.length||mode==="--score"&&!inputFile||
    mode!=="--score"&&inputFile){
    throw new Error("Usage: --offline | --packet | --score <local-review-and-run-receipts.json>");
  }
  const local=process.env.LOCALAPPDATA??process.cwd();
  const folder=join(local,"AgenticShopify","Evaluations");
  await mkdir(folder,{recursive:true});
  if(mode==="--packet"){
    const target=join(folder,"swarm-eval-30-blind-packet-v1.json");
    await writeFile(target,JSON.stringify(blindEvaluationPacket(),null,2),"utf8");
    process.stdout.write(JSON.stringify({
      mode:"blind_review_packet",scenarios:EVALUATION_CASES.length,
      manifestDigest:EVALUATION_DIGEST,
      packetGenerated:true,
      humanReviewsRecorded:0,
      modelRequestsMade:0,merchantWritesMade:0,
      note:"Counterfactual synthetic scenario data, not 30 observed merchant cases."
    })+"\n");
    return;
  }
  if(mode==="--offline"){
    const findings=auditOfflineRouter();
    const target=join(folder,"swarm-eval-30-offline-safety-v1.json");
    await writeFile(target,JSON.stringify(findings,null,2),"utf8");
    process.stdout.write(JSON.stringify({
      ...findings,modelRequestsMade:0,merchantWritesMade:0,
      modelAccuracyValidated:false,
      subscriberLaunchEvidence:false
    })+"\n");
    return;
  }
  if(!inputFile||!/\.json$/i.test(inputFile))throw new Error("JSON scoring input required.");
  const raw=await readFile(resolve(inputFile),"utf8");
  if(raw.length>1024*1024)throw new Error("Evaluation input exceeds bounded size.");
  const input=JSON.parse(raw) as Parameters<typeof evaluateThirty>[0];
  if(!input||!Array.isArray(input.results)||!Array.isArray(input.reviews)){
    throw new Error("Missing independent review or model receipt arrays.");
  }
  const report=evaluateThirty(input);
  const target=join(folder,"swarm-eval-30-scored-v1.json");
  await writeFile(target,JSON.stringify(report,null,2),"utf8");
  process.stdout.write(JSON.stringify({
    mode:"scored_report",scenarioCount:report.scenarioCount,
    independentReviewPairs:report.independentReviewPairs,
    completePairedModelResults:report.completePairedModelResults,
    status:report.status,actualCostStatus:report.costs.actualCostScope,
    subscriberLaunch:report.acceptance.allowedToLaunchForSubscribers,
    modelRequestsMadeByScorer:0
  })+"\n");
}
main().catch(()=>{
  process.stderr.write("Offline evaluator refused invalid input or could not write its local report.\n");
  process.exitCode=1;
});
