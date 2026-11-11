import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

test("standalone dev-store preflight cannot call a provider or create a paid model attempt",()=>{
  const source=readFileSync(new URL("../scripts/check-swarm-ab.mts",import.meta.url),"utf8");
  assert.match(source,/READ-ONLY DIAGNOSTIC ONLY/);
  assert.match(source,/captureVerifiedShopifySnapshot/);
  for(const forbidden of [
    "geminiBoundedProvider","executeBoundedSwarmCase","executeSingleAgentBenchmark",
    "queueSwarmResearch","SWARM_ENABLE_PAID_MODEL_CALLS","GEMINI_API_KEY",
    "swarmInvocation.create","swarmExecution.create","swarmUsageMonth.update"
  ])assert.equal(source.includes(forbidden),false,forbidden);
  assert.match(source,/modelRequestsInitiatedByThisCheck:0/);
  assert.match(source,/merchantWritesPerformedByThisCheck:0/);
});
