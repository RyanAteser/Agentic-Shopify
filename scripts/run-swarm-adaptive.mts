import db from "../app/db.server";
import {geminiBoundedProvider} from "../app/lib/swarm-gemini.server";
import {executeAdaptiveSkepticCase} from "../app/lib/adaptive-skeptic.server";

/**
 * Manual one-shot owner CLI only. Never an HTTP route or recurring job.
 * A configured shop, enabled flags and model key are required.
 * Unknown model outcomes are NEVER retried.
 */
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=="--case"||!/^[a-z0-9]{12,40}$/.test(args[1])){
    throw new Error("Usage: --case <fresh-queued-case-id>");
  }
  const shop=process.env.SWARM_WORKER_ALLOWED_SHOP;
  if(!shop||process.env.SWARM_ADAPTIVE_ENABLED!=="true"||
     process.env.SWARM_ENABLE_PAID_MODEL_CALLS!=="true"){
    throw new Error("Adaptive model execution requires explicit owner consent.");
  }
  const provider=geminiBoundedProvider();
  const result=await executeAdaptiveSkepticCase({
    shop,caseId:args[1],provider
  });
  process.stdout.write(JSON.stringify({
    ...result,
    billingNote:"Request-attempt accounting and reported tokens are not a Google invoice.",
    merchantAction:"No Shopify writes. No claim is auto-approved."
  })+"\n");
}
main().catch(e=>{
  // Never log prompts, API keys, provider HTTP bodies or Shopify tokens.
  process.stderr.write("Adaptive worker stopped: "+(e instanceof Error?e.name:"Unknown")+"\n");
  process.exitCode=1;
}).finally(()=>db.$disconnect());
