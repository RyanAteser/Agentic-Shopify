import {geminiBoundedProvider} from "../app/lib/swarm-gemini.server";
import {executeBoundedSwarmCase,closeExpiredSwarmRun} from "../app/lib/swarm-executor.server";

/**
 * Owner-only, one-shot bounded runner. Never schedule in cron or expose on
 * the public Shopify app. No .env auto-load; credentials come from an
 * explicitly configured secret store / process environment.
 *
 * Required:
 *   SWARM_WORKER_ENABLED=true
 *   SWARM_EXECUTION_ENABLED=true
 *   SWARM_ENABLE_PAID_MODEL_CALLS=true
 *   SWARM_WORKER_ALLOWED_SHOP=<exact merchant myshopify domain>
 *   SWARM_GEMINI_MODEL=<explicit supported model>
 *   GEMINI_API_KEY=<server secret>
 *
 * Node 22+: node --import tsx scripts/run-swarm-bounded.mts --case <id>
 */
const args=process.argv.slice(2);
async function main(){
  if(args.length!==2||!["--case","--reconcile"].includes(args[0])){
    throw new Error("Usage: --case <case-id> or --reconcile <execution-id>");
  }
  const shop=process.env.SWARM_WORKER_ALLOWED_SHOP;
  if(!shop)throw new Error("SWARM_WORKER_ALLOWED_SHOP is required.");
  if(args[0]==="--case"){
    // Only this branch constructs a paid provider. Missing opt-in/key aborts
    // before any reservation or model request.
    const provider=geminiBoundedProvider();
    const result=await executeBoundedSwarmCase({shop,caseId:args[1],provider});
    process.stdout.write(JSON.stringify({result,notes:
      "Model citations are unverified. No Shopify write tools or automatic retries."})+"\n");
  }else{
    const result=await closeExpiredSwarmRun({shop,runId:args[1]});
    process.stdout.write(JSON.stringify({result,notes:
      "Abandoned invocation was NOT replayed. Check provider billing manually."})+"\n");
  }
}
main().catch(error=>{
  // Do not print raw HTTP bodies or prompts, which may contain merchant data.
  const name=error instanceof Error?error.name:"Error";
  process.stderr.write("Swarm worker blocked: "+name+"\n");
  process.exitCode=1;
});
