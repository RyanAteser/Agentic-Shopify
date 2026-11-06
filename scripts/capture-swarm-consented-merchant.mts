import {createHash,randomBytes} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import db from "../app/db.server";
import {captureVerifiedShopifySnapshot} from "../app/lib/swarm-evidence.server";
import {
  validateMerchantReadOnlyConsent,makeObservedCapture,makeReviewerPacket
} from "../app/lib/swarm-real-intake";

/**
 * Manual owner-operated, consent-record-gated Shopify Admin read only.
 * This app DOES NOT verify that the self-reported consent signer owns the
 * shop: classification remains "holdout_candidate_unverified".
 * Requires an existing, authorized offline read_products Shopify session.
 */
async function main(){
  const [flag,consentFile,...extra]=process.argv.slice(2);
  if(flag!=="--consent-file"||!consentFile||extra.length)
    throw new Error("Usage: --consent-file <approved-local-consent.json>");
  const root=join(process.env.LOCALAPPDATA??process.cwd(),
    "AgenticShopify","Evaluations","RealEvidenceIntake");
  const permitted=join(root,"Consents");
  const full=resolve(consentFile);
  if(!full.startsWith(resolve(permitted)+"\\")||!full.endsWith(".json"))
    throw new Error("Consent file must be in the owner's dedicated Consents folder.");
  const raw=await readFile(full,"utf8");
  if(raw.length>4096)throw new Error("Consent file exceeds bounded size.");
  const consent=validateMerchantReadOnlyConsent(JSON.parse(raw));
  await mkdir(root,{recursive:true});
  const saltPath=join(root,"cohort-merchant-pseudonym-salt.local");
  let salt:string;
  try{salt=(await readFile(saltPath,"utf8")).trim();}
  catch{
    salt=randomBytes(32).toString("base64url");
    try{await writeFile(saltPath,salt,{encoding:"utf8",flag:"wx"});}
    catch{salt=(await readFile(saltPath,"utf8")).trim();}
  }
  const merchantGroup="m-"+createHash("sha256").update(salt+"\0"+consent.shop).digest("hex").slice(0,20);
  const date=new Date().toISOString().slice(0,10);
  const privatePath=join(root,merchantGroup+"-"+date+"-observation-private.json");
  const reviewerPath=join(root,merchantGroup+"-"+date+"-blind-review.json");
  try{
    await readFile(privatePath,"utf8");
    throw new Error("Observation for this merchant/date already exists; no overwrite.");
  }catch(e){
    if(!(e&&typeof e==="object"&&"code" in e&&e.code==="ENOENT"))throw e;
  }
  const session=await db.session.findFirst({where:{shop:consent.shop,isOnline:false},
    select:{accessToken:true,scope:true,expires:true}});
  if(!session||session.expires&&session.expires<new Date()||
     !session.scope?.split(",").includes("read_products")){
    throw new Error("Existing authorized read_products Shopify installation is absent or expired.");
  }
  const admin={graphql:async(query:string)=>{
    const response=await fetch("https://"+consent.shop+"/admin/api/2026-10/graphql.json",{
      method:"POST",signal:AbortSignal.timeout(12000),redirect:"error",
      headers:{"X-Shopify-Access-Token":session.accessToken,
        "Content-Type":"application/json"},body:JSON.stringify({query})
    });
    if(!response.ok)throw new Error("Authenticated Shopify read was rejected.");
    return {json:()=>response.json() as Promise<unknown>};
  }};
  const snapshot=await captureVerifiedShopifySnapshot(admin,consent.shop);
  const capture=makeObservedCapture({
    snapshot,groupingSalt:salt,cohortClass:"holdout_candidate_unverified",
    consentNote:"Owner-supplied authorization reference: "+consent.consentEvidenceReference+
      ". Independent merchant identity validation remains pending."
  });
  if(capture.merchantGroup!==merchantGroup)
    throw new Error("Merchant pseudonym mismatch.");
  await writeFile(privatePath,JSON.stringify(capture,null,2),{
    encoding:"utf8",flag:"wx"
  });
  await writeFile(reviewerPath,JSON.stringify(makeReviewerPacket(capture),null,2),{
    encoding:"utf8",flag:"wx"
  });
  process.stdout.write(JSON.stringify({
    result:"new_authorized_readonly_snapshot",
    merchantGroup,captureId:capture.captureId,
    caseCount:capture.cases.length,
    sourceVerified:true,
    sourceShopIdentityValidatedByShopify:true,
    consentSignerIndependentlyVerified:false,
    heldOutIndependenceProven:false,
    independentHumanReviews:0,
    modelRequests:0,shopifyWrites:0
  })+"\n");
}
main().catch(e=>{
  process.stderr.write("Consent-gated capture stopped: "+
    (e instanceof Error?e.name:"unknown")+"\n");
  process.exitCode=1;
}).finally(()=>db.$disconnect());
