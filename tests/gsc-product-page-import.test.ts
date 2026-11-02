import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { encryptToken } from "../app/lib/gsc-crypto.server";
import { syncGscProductPages, disconnectGoogle, storeGoogleConnection } from "../app/lib/gsc.server";
import { eraseMerchantData } from "../app/lib/merchant-redaction.server";

const domain = "store.example.test";
const origin = "https://" + domain;
const productUrls = [origin+"/products/one",origin+"/products/two"];
const mkShop=()=> "gsc-pages-"+randomUUID()+".myshopify.com";
const time=new Date("2026-11-02T18:00:00.000Z");
const day="2026-10-20";

function adminFor(shop:string,foreignUrl=false){
  return {
    async graphql(query:string){
      if(query.includes("RankingStorefrontDomain")){
        return {json:async()=>({data:{shop:{myshopifyDomain:shop,primaryDomain:{host:domain}}}})};
      }
      if(query.includes("ShopifySeoCatalog")){
        return {json:async()=>({data:{products:{
          nodes:productUrls.map((url,i)=>({
            id:"gid://shopify/Product/"+(i+1),title:"Product "+i,description:"Real title only",
            onlineStoreUrl:foreignUrl && i===1?
              "https://monikablunderbeauty.com/products/unrelated":url,
            seo:{title:null,description:null}
          })),
          pageInfo:{hasNextPage:false,endCursor:null}
        }}})};
      }
      throw new Error("Unexpected Shopify Admin query");
    }
  };
}

async function withConnectedShop(fn:(shop:string)=>Promise<void>){
  const shop=mkShop();
  const prev={};
  const keys=["GSC_CLIENT_ID","GSC_CLIENT_SECRET","GSC_ENCRYPTION_KEY","SHOPIFY_APP_URL"] as const;
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const originalFetch=globalThis.fetch;
  process.env.GSC_CLIENT_ID="test-only-client";
  process.env.GSC_CLIENT_SECRET="test-only-secret";
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,76).toString("base64");
  process.env.SHOPIFY_APP_URL="https://app.example.test";
  try{
    await db.storeConfig.create({data:{shop}});
    await db.searchConsoleConnection.create({data:{
      shop,property:origin+"/",encryptedRefresh:encryptToken("fake-refresh")
    }});
    await fn(shop);
  }finally{
    globalThis.fetch=originalFetch;
    await eraseMerchantData(shop);
    for(const key of keys){
      if(saved[key]===undefined)delete process.env[key];
      else process.env[key]=saved[key];
    }
  }
}

function mockGoogle(options:{
  empty?:boolean, brokenSecond?:boolean, onPage?:(num:number)=>Promise<void>
}={}){
  let requests=0;
  const bodies:unknown[]=[];
  globalThis.fetch=async (input,init)=>{
    const target=String(input);
    if(target==="https://oauth2.googleapis.com/token"){
      return Response.json({access_token:"fake-access"});
    }
    if(target==="https://oauth2.googleapis.com/revoke")return Response.json({});
    if(target.includes("/searchAnalytics/query")){
      requests++;
      const body=JSON.parse(String(init?.body));
      bodies.push(body);
      if(options.onPage)await options.onPage(requests);
      if(options.brokenSecond && requests===2){
        return Response.json({responseAggregationType:"byProperty",rows:[]});
      }
      const url=body.dimensionFilterGroups[0].filters[0].expression;
      return Response.json({responseAggregationType:"byPage",
        rows:options.empty?[]:[{
          keys:[day,url],clicks:2,impressions:20,ctr:0.1,position:4
        }]});
    }
    throw new Error("Unexpected outbound Google request");
  };
  return {bodies,get requests(){return requests;}};
}

test("explicit read-only sync uses Shopify URLs, isolates tenant and enforces hourly limit", async()=>{
  await withConnectedShop(async shop=>{
    const google=mockGoogle();
    const result=await syncGscProductPages(shop,adminFor(shop),time);
    assert.deepEqual({pages:result.pages,observedRows:result.observedRows},{pages:2,observedRows:2});
    assert.equal(google.requests,2);
    assert.equal(await db.gscProductDailyMetric.count({where:{shop}}),2);
    assert.equal(await db.gscProductDailyMetric.count({where:{shop:"other.myshopify.com"}}),0);
    for(const body of google.bodies as any[]){
      assert.deepEqual(body.dimensions,["date","page"]);
      assert.equal(body.aggregationType,"byPage");
      assert.equal(body.dataState,"final");
      assert.equal(body.dimensionFilterGroups[0].filters[0].operator,"equals");
      assert.ok(productUrls.includes(body.dimensionFilterGroups[0].filters[0].expression));
      assert.ok(!JSON.stringify(body).includes("monikablunderbeauty"));
    }
    await assert.rejects(syncGscProductPages(shop,adminFor(shop),
      new Date(time.getTime()+5*60000)),/hourly sync lease/);
    assert.equal(google.requests,2);
    // A valid empty later snapshot replaces stale observations. It never
    // fabricates 56 zero-click rows for Google's omitted dates.
    mockGoogle({empty:true});
    const later=await syncGscProductPages(shop,adminFor(shop),
      new Date(time.getTime()+61*60000));
    assert.equal(later.observedRows,0);
    assert.equal(await db.gscProductDailyMetric.count({where:{shop}}),0);
    assert.ok((await db.searchConsoleConnection.findUniqueOrThrow({where:{shop}})).lastPageSyncedAt);
  });
});

test("Google failure on second page aborts entire snapshot and releases import lease",async()=>{
  await withConnectedShop(async shop=>{
    mockGoogle();
    await syncGscProductPages(shop,adminFor(shop),time);
    const before=await db.gscProductDailyMetric.findMany({
      where:{shop},select:{pageUrl:true,date:true,clicks:true}
    });
    mockGoogle({brokenSecond:true});
    await assert.rejects(syncGscProductPages(shop,adminFor(shop),
      new Date(time.getTime()+61*60000)),/aggregation/);
    const after=await db.gscProductDailyMetric.findMany({
      where:{shop},select:{pageUrl:true,date:true,clicks:true}
    });
    assert.deepEqual(after,before);
    const conn=await db.searchConsoleConnection.findUniqueOrThrow({where:{shop}});
    assert.equal(conn.lastPageSyncStartedAt,null);
    assert.equal(conn.lastPageSyncedAt?.getTime(),time.getTime());
  });
});

test("cross-store public pages cannot be queried even with valid merchant consent",async()=>{
  await withConnectedShop(async shop=>{
    const g=mockGoogle();
    const result=await syncGscProductPages(shop,adminFor(shop,true),time);
    assert.equal(result.pages,1);
    assert.equal(g.requests,1);
    assert.equal(await db.gscProductDailyMetric.count({where:{shop}}),1);
  });
});

test("disconnect during Google page import cannot resurrect metrics or consent",async()=>{
  await withConnectedShop(async shop=>{
    let release!:()=>void, signal!:()=>void;
    const hold=new Promise<void>(resolve=>release=resolve);
    const begun=new Promise<void>(resolve=>signal=resolve);
    mockGoogle({onPage:async count=>{
      if(count===1){signal();await hold;}
    }});
    const pending=syncGscProductPages(shop,adminFor(shop),time);
    await begun;
    await disconnectGoogle(shop);
    release();
    await assert.rejects(pending,/consent or page sync lease changed/);
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),0);
    assert.equal(await db.gscProductDailyMetric.count({where:{shop}}),0);
  });
});

test("re-consent resets prior product GSC observations and page sync times",async()=>{
  await withConnectedShop(async shop=>{
    mockGoogle();
    await syncGscProductPages(shop,adminFor(shop),time);
    const stateHash=randomUUID().replace(/-/g,"").padEnd(64,"a").slice(0,64);
    await db.googleAuthState.create({
      data:{shop,stateHash,expiresAt:new Date(Date.now()+120000)}
    });
    await storeGoogleConnection(shop,origin+"/","new-fake-refresh",stateHash);
    assert.equal(await db.gscProductDailyMetric.count({where:{shop}}),0);
    const connection=await db.searchConsoleConnection.findUniqueOrThrow({where:{shop}});
    assert.equal(connection.lastPageSyncedAt,null);
    assert.equal(connection.lastPageSyncStartedAt,null);
  });
});
