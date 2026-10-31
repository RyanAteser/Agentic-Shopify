/** Privacy-minimized cost sensitivity for the existing paired editorial pilot.
 * Read-only: no network, merchant account, live billing, publishing or store access.
 */
import {readFileSync,statSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {evaluatePilot} from "./merchant-pilot-evaluate.mjs";

const COST_PROTOCOL = "paired-editorial-costs-v1";
function fail(message) { throw new Error("Invalid pilot costs: " + message); }
function exact(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(k => !keys.includes(k)) ||
      keys.some(k => !Object.hasOwn(value, k))) fail(name + " has missing or unexpected fields");
  return value;
}
function cents(value, limit, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit)
    fail(name + " must be an integer number of cents from 0 to " + limit);
  return value;
}
function costsByArm(pilot, rows, name, laborRate) {
  const finished = pilot.pairs.filter(p => p.ai !== null && p.manual !== null);
  const laborMinutes = finished.reduce((sum,p) => sum + p[name].laborMinutes, 0);
  const externalCents = finished.reduce((sum,p) => sum + rows.get(p.id)[name+"ExternalCostCents"], 0);
  const qualityPasses = finished.filter(p => p[name].decision === "usable" &&
    p[name].criticalFactualErrors === 0 && p[name].productLinkErrors === 0).length;
  const valuedLaborCents = laborMinutes * laborRate / 60;
  const totalCents = valuedLaborCents + externalCents;
  return {attempts:finished.length,qualityPasses,laborMinutes,
    externalCents,valuedLaborCents,totalCents,
    centsPerQualityPass: qualityPasses ? totalCents/qualityPasses : null};
}
function scenario(pilot,rows,hourlyCents,ready) {
  if (!ready) return null;
  const ai=costsByArm(pilot,rows,"ai",hourlyCents);
  const manual=costsByArm(pilot,rows,"manual",hourlyCents);
  const possible=ai.centsPerQualityPass !== null && manual.centsPerQualityPass !== null;
  const breakEvenAiExternalCentsTotal=manual.centsPerQualityPass===null || ai.qualityPasses===0 ? null :
    manual.centsPerQualityPass*ai.qualityPasses-ai.valuedLaborCents;
  const breakEvenAiExternalCentsPerAttempt=breakEvenAiExternalCentsTotal===null ? null :
    breakEvenAiExternalCentsTotal/ai.attempts;
  return {laborValueCentsPerHour:hourlyCents,ai,manual,
    breakEvenAiExternalCentsTotal,breakEvenAiExternalCentsPerAttempt,
    manualMinusAiCentsPerQualityPass:possible ? manual.centsPerQualityPass-ai.centsPerQualityPass:null,
    relativeAiCostPct:possible && manual.centsPerQualityPass>0 ?
      100*(ai.centsPerQualityPass/manual.centsPerQualityPass-1) : null};
}

/** The ledger is a separate, strictly numeric file to avoid leaking draft text or merchant identifiers.
 * External cost may include measured provider fees and allocated operating cost, but the evaluator
 * cannot attest that it does. Always treat all cost data as user-supplied.
 */
export function evaluatePilotEconomics(pilot,ledger) {
  const pilotResult=evaluatePilot(pilot);
  exact(ledger,["protocol","currency","costBasis","laborValueCentsPerHour","pairs"],"root");
  if (ledger.protocol !== COST_PROTOCOL) fail("unsupported protocol");
  if (ledger.currency !== "USD") fail("cost currency must be USD");
  if (!["estimated","invoice-backed"].includes(ledger.costBasis)) fail("costBasis invalid");
  cents(ledger.laborValueCentsPerHour,1_000_000,"laborValueCentsPerHour");
  if (!Array.isArray(ledger.pairs) || ledger.pairs.length > 500) fail("pairs must be a bounded array");
  const expectedIds=new Set(pilot.pairs.map(p=>p.id));
  const rows=new Map();
  for (const [index,row] of ledger.pairs.entries()) {
    exact(row,["id","aiExternalCostCents","manualExternalCostCents"],"pairs["+index+"]");
    if (typeof row.id !== "string" || !expectedIds.has(row.id) || rows.has(row.id))
      fail("cost ledger has an unknown or duplicate pair identifier");
    cents(row.aiExternalCostCents,1_000_000,"aiExternalCostCents");
    cents(row.manualExternalCostCents,1_000_000,"manualExternalCostCents");
    rows.set(row.id,row);
  }
  if (rows.size !== expectedIds.size) fail("cost ledger omits a recorded pair");
  const ready=pilotResult.status === "ready-for-external-review";
  const rate=ledger.laborValueCentsPerHour;
  const scenarios={
    halfLaborValue:scenario(pilot,rows,rate/2,ready),
    declaredLaborValue:scenario(pilot,rows,rate,ready),
    doubleLaborValue:scenario(pilot,rows,rate*2,ready)
  };
  const declared=scenarios.declaredLaborValue;
  const difference=declared?.manualMinusAiCentsPerQualityPass;
  const allFavorAi=Object.values(scenarios).every(s=>s?.manualMinusAiCentsPerQualityPass>0);
  const decisionSupport=!ready?"insufficient-pilot-evidence":
    difference===null?"zero-quality-passes":
    pilotResult.decisionSupport!=="candidate-for-independent-review"?"editorial-gates-not-met":
    difference<=0?"no-cost-advantage":
    !allFavorAi?"labor-value-sensitive":
    ledger.costBasis!=="invoice-backed"?"estimated-costs-only":
    "candidate-for-independent-cost-review";
  return {
    protocol:COST_PROTOCOL,currency:"USD",pilotStatus:pilotResult.status,
    editorialDecisionSupport:pilotResult.decisionSupport,
    merchantDiversity:pilotResult.merchantDiversity,
    recordedCostPairs:rows.size,plannedPairs:pilotResult.plannedPairs,
    costBasis:ledger.costBasis,scenarios,decisionSupport,
    limitations:[
      "All ledger costs and costBasis flags are user-supplied, not independently verified against invoices.",
      "External cost must include AI model usage and an appropriately allocated share of n8n, hosting and other operating costs; omissions can reverse the result.",
      "Labor value is a scenario assumption, not a measured wage or cash saving. Half/double sensitivities do not identify a true opportunity cost.",
      "Quality passes require usable decisions with zero critical factual and product-link errors; rejected attempts still incur labor and external cost.",
      "No comparative economic figures are emitted until the entire preregistered, counterbalanced, blinded pilot passes its evidence gates.",
      "Merchant-group diversity is self-attested, and repeated pairs within a merchant may be correlated. A candidate is not a cluster-robust statistical result.",
      "Break-even AI external-cost budgets are quality-adjusted scenario thresholds, not vendor quotes or authorization to spend; negative budgets mean labor alone already exceeds manual cost per quality pass.",
      "The result is descriptive, not a statistical confidence interval, a causal effect, a Shopify revenue estimate or permission to deploy, bill or publish."
    ]
  };
}
function readJson(path) {
  // Bound allocation before reading an accidentally supplied large merchant export.
  if (statSync(path).size>1024*1024) fail("input exceeds 1 MiB");
  const raw=readFileSync(path);
  if (raw.length>1024*1024) fail("input exceeds 1 MiB");
  return JSON.parse(raw.toString("utf8"));
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length!==4) fail("usage: node scripts/merchant-pilot-economics.mjs pilot.json costs.json");
    console.log(JSON.stringify(evaluatePilotEconomics(readJson(process.argv[2]),readJson(process.argv[3])),null,2));
  } catch (error) {
    console.error(error instanceof Error?error.message:"Cost evaluation failed");
    process.exitCode=1;
  }
}
