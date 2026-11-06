import {randomBytes} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import db from "../app/db.server";
import {captureVerifiedShopifySnapshot} from "../app/lib/swarm-evidence.server";
import {makeObservedCapture,makeReviewerPacket,realCohortReadiness}
  from "../app/lib/swarm-real-intake";

/**
 * Authorized read-only Artemis calibration capture only.
 * No Shopify CLI, no Shopify mutations, no model provider, no paid calls.
 * Immutable once per calibrated shop; no artificial case amplification.
 */
async function main(){
  if(process.argv.slice(2).join(" ")!=="--artemis-calibration-readonly")
    throw new Error("Usage: --artemis-calibration-readonly");
  const shop="artemisti.myshopify.com";
  const folder=join(process.env.LOCALAPPDATA??process.cwd(),
    "AgenticShopify","Evaluations","RealEvidenceIntake");
  await mkdir(folder,{recursive:true});
  const privatePath=join(folder,"artemis-calibration-first-observation.json");
  const packetPath=join(folder,"artemis-calibration-blind-review-packet.json");
  const saltPath=join(folder,"cohort-merchant-pseudonym-salt.local");
  let salt:string;
  try{salt=(await readFile(saltPath,"utf8")).trim();}
  catch{
    salt=randomBytes(32).toString("base64url");
    try{await writeFile(saltPath,salt,{encoding:"utf8",flag:"wx"});}
    catch{salt=(await readFile(saltPath,"utf8")).trim();}
  }
  try{
    const saved=JSON.parse(await readFile(privatePath,"utf8")) as
      {captureId:string;cases:{id:string}[];merchantGroup:string;sourceDigest:string};
    process.stdout.write(JSON.stringify({
      status:"already_captured_no_replay",captureId:saved.captureId,
      group:saved.merchantGroup,caseCount:saved.cases?.length??0,
      modelRequests:0,shopifyWrites:0})+"\n");
    return;
  }catch(e){
    if(e&&typeof e==="object"&&"code" in e&&e.code==="ENOENT"){
      // First snapshot only.
    }else{
      throw new Error("Existing capture unreadable; refusing to overwrite.");
    }
  }
  const session=await db.session.findFirst({where:{shop,isOnline:false},
    select:{accessToken:true,scope:true,expires:true}});
  if(!session||session.expires&&session.expires<new Date()||
     !session.scope?.split(",").includes("read_products")){
    throw new Error("No active bounded Shopify Admin session.");
  }
  const admin={graphql:async(query:string)=>{
    const response=await fetch("https://"+shop+"/admin/api/2026-10/graphql.json",{
      method:"POST",signal:AbortSignal.timeout(12000),redirect:"error",
      headers:{"Content-Type":"application/json",
        "X-Shopify-Access-Token":session.accessToken},
      body:JSON.stringify({query})
    });
    if(!response.ok)throw new Error("Shopify read-only API unavailable.");
    return {json:()=>response.json() as Promise<unknown>};
  }};
  const snapshot=await captureVerifiedShopifySnapshot(admin,shop);
  const privateCapture=makeObservedCapture({
    snapshot,groupingSalt:salt,
    cohortClass:"calibration_seen_development_store",
    consentNote:"Owner-requested, bounded read-only developer-store evaluation from existing read_products authorization."
  });
  const packet=makeReviewerPacket(privateCapture);
  // The private group salt and shop identity never appear in reviewer packet.
  // Both files are created exclusively, not overwritten on a second run.
  await writeFile(privatePath,JSON.stringify(privateCapture,null,2),{encoding:"utf8",flag:"wx"});
  await writeFile(packetPath,JSON.stringify(packet,null,2),{encoding:"utf8",flag:"wx"});
  const readiness=realCohortReadiness({
    captures:[privateCapture],reviews:[],pairedModelCases:[]
  });
  process.stdout.write(JSON.stringify({
    status:"calibration_observation_captured",
    sourceVerified:true,captureId:privateCapture.captureId,
    caseCount:packet.cases.length,
    sourceDigest:privateCapture.sourceDigest,
    sampleCounts:{
      all:snapshot.allProductsSampled,
      active:snapshot.activeProductsInSample,
      activePublished:snapshot.publishedActiveProductsInSample,
      publishedUrls:snapshot.publishedProductsWithOnlineStoreUrl,
      passwordEnabled:snapshot.storefrontPasswordEnabled
    },
    independentReviewers:0,holdoutEligibleCases:0,
    independentMerchantGroups:readiness.eligibleHoldoutCandidateMerchantGroups,
    modelRequests:0,shopifyWrites:0,
    reviewPacketSaved:true
  })+"\n");
}
main().catch((e)=>{
  process.stderr.write("Real observation intake stopped: "+
    (e instanceof Error?e.name:"unknown")+"\n");
  process.exitCode=1;
}).finally(()=>db.$disconnect());
