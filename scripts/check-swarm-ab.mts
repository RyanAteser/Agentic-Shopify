import db from "../app/db.server";
import {captureVerifiedShopifySnapshot} from "../app/lib/swarm-evidence.server";
import {loadSwarmTeam} from "../app/lib/swarm-roster.server";
import {BENCHMARK_CASES} from "../app/lib/swarm-benchmark-policy";

/**
 * READ-ONLY DIAGNOSTIC ONLY. This module never imports a provider, queues work,
 * mutates a merchant database record, reserves credits or calls model APIs.
 * Invoke: node --import tsx scripts/check-swarm-ab.mts
 */
async function main(){
  const shop="artemisti.myshopify.com";
  const session=await db.session.findFirst({where:{shop,isOnline:false},
    select:{accessToken:true,scope:true,expires:true}});
  const auth=!!session&&(!session.expires||session.expires>new Date())&&
    !!session.scope?.split(",").includes("read_products");
  const [{participants},usage,open,existing]=await Promise.all([
    loadSwarmTeam(shop),
    db.swarmUsageMonth.findFirst({where:{shop,month:new Date().toISOString().slice(0,7)},
      select:{consumed:true,reserved:true}}),
    db.swarmCase.count({where:{shop,status:{in:["queued","researching","challenged","needs_evidence"]}}}),
    db.swarmCase.findMany({where:{shop,title:{in:BENCHMARK_CASES.map(x=>x.question)}},
      select:{title:true,status:true},take:20})
  ]);
  let snapshot=null;
  let sourceStatus=auth?"unavailable":"session_expired_or_missing";
  if(auth&&session){
    try{
      const admin={graphql:async(query:string)=>{
        const r=await fetch("https://"+shop+"/admin/api/2026-10/graphql.json",{
          method:"POST",redirect:"error",signal:AbortSignal.timeout(12_000),
          headers:{"Content-Type":"application/json",
            "X-Shopify-Access-Token":session.accessToken},
          body:JSON.stringify({query})
        });
        if(!r.ok)throw new Error("Authenticated Shopify read failed.");
        return {json:()=>r.json() as Promise<unknown>};
      }};
      snapshot=await captureVerifiedShopifySnapshot(admin,shop);
      sourceStatus="verified";
    }catch{
      sourceStatus="unavailable";
    }
  }
  process.stdout.write(JSON.stringify({
    diagnostic:"read_only_preflight",shop,
    sessionValid:auth,
    sourceStatus,
    counts:snapshot?{
      all:snapshot.allProductsSampled,
      active:snapshot.activeProductsInSample,
      published:snapshot.publishedActiveProductsInSample,
      publishedWithPublicUrl:snapshot.publishedProductsWithOnlineStoreUrl,
      storefrontPasswordEnabled:snapshot.storefrontPasswordEnabled
    }:null,
    roster:{specialists:participants.totalSpecialists,skeptics:participants.totalSkeptics},
    attemptMeter:{consumed:usage?.consumed??0,reserved:usage?.reserved??0,
      remaining:25-(usage?.consumed??0)-(usage?.reserved??0)},
    openCases:open,
    frozenCases:BENCHMARK_CASES.map(x=>({
      id:x.id,everQueued:existing.some(y=>y.title===x.question)
    })),
    modelRequestsInitiatedByThisCheck:0,
    merchantWritesPerformedByThisCheck:0
  })+"\n");
}
main().catch(()=>{
  process.stderr.write("READ_ONLY_PREFLIGHT_UNAVAILABLE\n");
  process.exitCode=1;
}).finally(()=>db.$disconnect());
