import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {disconnectGoogle,storeGoogleConnection,syncOrganicMetrics,verifyGoogleSite} from "../app/lib/gsc.server";
import {encryptToken} from "../app/lib/gsc-crypto.server";

async function connectWithPendingState(shop:string,property:string,token:string){
  // Callback finalization now requires a still-connected merchant. Tests
  // explicitly establish the merchant rather than creating orphaned consent.
  await db.storeConfig.upsert({where:{shop},create:{shop},update:{}});
  const stateHash=randomUUID();
  await db.googleAuthState.create({
    data:{stateHash,shop,expiresAt:new Date(Date.now()+60_000)}
  });
  await storeGoogleConnection(shop,property,token,stateHash);
}

/**
 * A merchant can revoke consent while Google's HTTP request is still in flight.
 * The old importer must never resurrect data after the disconnect transaction.
 * Runs on SQLite and PostgreSQL CI, without real Google credentials or traffic.
 */
test("GSC import is cancelled by consent deletion and still works with active consent",async()=>{
  const envKeys=["GSC_CLIENT_ID","GSC_CLIENT_SECRET","GSC_ENCRYPTION_KEY","SHOPIFY_APP_URL"] as const;
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const originalFetch=globalThis.fetch;
  process.env.GSC_CLIENT_ID="integration-test-client";
  process.env.GSC_CLIENT_SECRET="integration-test-secret";
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,23).toString("base64");
  process.env.SHOPIFY_APP_URL="https://app.example.test";
  const revokedShop="revoked-"+randomUUID()+".myshopify.com";
  const activeShop="active-"+randomUUID()+".myshopify.com";
  let releaseRefresh!:()=>void;
  let signalRefresh!:()=>void;
  const refreshGate=new Promise<void>(resolve=>{releaseRefresh=resolve;});
  const refreshStarted=new Promise<void>(resolve=>{signalRefresh=resolve;});
  let pauseRefresh=true;
  let aggregationType="byProperty";
  let reportedCtr=0.1;
  let pending:Promise<unknown>|undefined;
  globalThis.fetch=async input=>{
    const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    if(url==="https://oauth2.googleapis.com/token"){
      if(pauseRefresh){
        signalRefresh();
        await refreshGate;
      }
      return Response.json({access_token:"test-access-token"});
    }
    if(url.includes("/searchAnalytics/query")){
      return Response.json({responseAggregationType:aggregationType,rows:[{
        keys:["2026-10-01"],clicks:5,impressions:50,ctr:reportedCtr,position:8
      }]});
    }
    if(url==="https://oauth2.googleapis.com/revoke")return Response.json({});
    throw new Error("Unexpected external request: "+url);
  };
  try{
    await connectWithPendingState(revokedShop,"https://example.test/","refresh-token-1");
    pending=syncOrganicMetrics(revokedShop,new Date("2026-10-26T12:00:00Z"));
    await refreshStarted;
    await disconnectGoogle(revokedShop);
    releaseRefresh();
    await assert.rejects(pending,/consent or sync lease changed/);
    assert.equal(await db.searchConsoleConnection.count({where:{shop:revokedShop}}),0);
    assert.equal(await db.organicDailyMetric.count({where:{shop:revokedShop}}),0);

    // Positive control: the guard must not suppress legitimate imports.
    pauseRefresh=false;
    await connectWithPendingState(activeShop,"https://example.test/","refresh-token-2");
    const syncNow=new Date("2026-10-26T12:00:00Z");
    aggregationType="byPage";
    await assert.rejects(syncOrganicMetrics(activeShop,syncNow),/aggregation type/);
    assert.equal(await db.organicDailyMetric.count({where:{shop:activeShop}}),0);
    reportedCtr=0.9;
    aggregationType="byProperty";
    await assert.rejects(syncOrganicMetrics(activeShop,syncNow),/Inconsistent Google metric values/);
    assert.equal(await db.organicDailyMetric.count({where:{shop:activeShop}}),0);
    reportedCtr=0.1;
    const result=await syncOrganicMetrics(activeShop,syncNow);
    assert.equal(result.rows,1);
    assert.equal(await db.organicDailyMetric.count({where:{shop:activeShop}}),1);
  }finally{
    releaseRefresh();
    await pending?.catch(()=>{});
    globalThis.fetch=originalFetch;
    await db.organicDailyMetric.deleteMany({where:{shop:{in:[revokedShop,activeShop]}}});
    await db.searchConsoleConnection.deleteMany({where:{shop:{in:[revokedShop,activeShop]}}});
    await db.storeConfig.deleteMany({where:{shop:{in:[revokedShop,activeShop]}}});
    for(const key of envKeys){
      if(previous[key]===undefined)delete process.env[key];
      else process.env[key]=previous[key];
    }
  }
});

test("pending Google OAuth cannot reconnect after disconnect, expire, replay, or cross shops",async()=>{
  const oldKey=process.env.GSC_ENCRYPTION_KEY;
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,31).toString("base64");
  const shop="oauth-"+randomUUID()+".myshopify.com";
  const other="other-"+randomUUID()+".myshopify.com";
  const property="https://example.test/";
  const revokedHash=randomUUID(),expiredHash=randomUUID(),validHash=randomUUID();
  const createState=(stateHash:string,owner=shop,expiresAt=new Date(Date.now()+60_000))=>
    db.googleAuthState.create({data:{stateHash,shop:owner,expiresAt}});
  try{
    await db.storeConfig.create({data:{shop}});
    // The callback already read this state, then stalled during Google HTTP.
    // Merchant disconnects while no connection has yet been persisted.
    await createState(revokedHash);
    await disconnectGoogle(shop);
    await assert.rejects(
      storeGoogleConnection(shop,property,"stale-refresh",revokedHash),/expired or revoked/
    );
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),0);

    await createState(expiredHash,shop,new Date(Date.now()-60_000));
    await assert.rejects(
      storeGoogleConnection(shop,property,"expired-refresh",expiredHash),/expired or revoked/
    );
    // A stale broad-domain callback cannot consume OAuth consent or create
    // misleading cross-host site metrics, even if called directly.
    const broadHash=randomUUID();
    await createState(broadHash);
    await assert.rejects(
      storeGoogleConnection(shop,"sc-domain:example.test","broad-refresh",broadHash),
      /exact HTTPS URL-prefix/
    );
    assert.equal(await db.googleAuthState.count({where:{stateHash:broadHash}}),1);
    await createState(validHash);
    await assert.rejects(
      storeGoogleConnection(other,property,"wrong-shop-refresh",validHash),/expired or revoked/
    );
    assert.equal(await db.googleAuthState.count({where:{stateHash:validHash}}),1);

    // A legitimate callback commits consent once; a replay cannot replace it.
    await storeGoogleConnection(shop,property,"valid-refresh",validHash);
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),1);
    assert.equal(await db.googleAuthState.count({where:{stateHash:validHash}}),0);
    await assert.rejects(
      storeGoogleConnection(shop,property,"replay-refresh",validHash),/expired or revoked/
    );
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),1);
  }finally{
    await db.googleAuthState.deleteMany({where:{shop:{in:[shop,other]}}});
    await db.searchConsoleConnection.deleteMany({where:{shop:{in:[shop,other]}}});
    await db.storeConfig.deleteMany({where:{shop:{in:[shop,other]}}});
    if(oldKey===undefined)delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY=oldKey;
  }
});


test("GSC verification selects only an exact HTTPS storefront URL-prefix",async()=>{
  const originalFetch=globalThis.fetch;
  let includeExact=true;
  globalThis.fetch=async input=>{
    const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    assert.equal(url,"https://www.googleapis.com/webmasters/v3/sites");
    return Response.json({siteEntry:[
      {siteUrl:"sc-domain:example.com",permissionLevel:"siteOwner"},
      {siteUrl:"https://other.example.com/",permissionLevel:"siteOwner"},
      {siteUrl:"https://store.example.com/",permissionLevel:"siteUnverifiedUser"},
      {siteUrl:"https://store.example.com/",permissionLevel:"siteUnknown"},
      {siteUrl:"https://store.example.com/"},
      ...(includeExact?[{siteUrl:"https://store.example.com/",permissionLevel:"siteRestrictedUser"}]:[])
    ]});
  };
  try{
    assert.equal(await verifyGoogleSite("test-token","store.example.com"),"https://store.example.com/");
    includeExact=false;
    await assert.rejects(verifyGoogleSite("test-token","store.example.com"),
      /HTTPS URL-prefix/);
  }finally{
    globalThis.fetch=originalFetch;
  }
});


test("legacy broad GSC connection cannot sync or spend Google quota",async()=>{
  const priorKey=process.env.GSC_ENCRYPTION_KEY;
  const oldFetch=globalThis.fetch;
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,29).toString("base64");
  const shop="legacy-"+randomUUID()+".myshopify.com";
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error("Google must not be contacted");};
  try{
    await db.searchConsoleConnection.create({data:{
      shop,property:"sc-domain:example.test",encryptedRefresh:encryptToken("old-refresh")
    }});
    await assert.rejects(syncOrganicMetrics(shop,new Date("2026-10-26T12:00:00Z")),
      /Reconnect Search Console/);
    assert.equal(calls,0);
    assert.equal(await db.organicDailyMetric.count({where:{shop}}),0);
  }finally{
    globalThis.fetch=oldFetch;
    await db.searchConsoleConnection.deleteMany({where:{shop}});
    if(priorKey===undefined)delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY=priorKey;
  }
});


test("GSC snapshots retire omitted dates without touching other shops or historical ranges",async()=>{
  const envKeys=["GSC_CLIENT_ID","GSC_CLIENT_SECRET","GSC_ENCRYPTION_KEY","SHOPIFY_APP_URL"] as const;
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const originalFetch=globalThis.fetch;
  process.env.GSC_CLIENT_ID="snapshot-test-client";
  process.env.GSC_CLIENT_SECRET="snapshot-test-secret";
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,41).toString("base64");
  process.env.SHOPIFY_APP_URL="https://app.example.test";
  const shop="snapshot-"+randomUUID()+".myshopify.com";
  const otherShop="neighbor-"+randomUUID()+".myshopify.com";
  const property="https://example.test/";
  const day=(date:string)=>({keys:[date],clicks:5,impressions:50,ctr:0.1,position:8});
  let rows:unknown=[day("2026-10-01"),day("2026-10-02")];
  let aggregationType="byProperty";
  globalThis.fetch=async input=>{
    const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    if(url==="https://oauth2.googleapis.com/token")return Response.json({access_token:"snapshot-access"});
    if(url.includes("/searchAnalytics/query"))return Response.json({
      responseAggregationType:aggregationType,
      ...(rows===undefined?{}:{rows})
    });
    throw new Error("Unexpected Google request: "+url);
  };
  const currentDates={gte:"2026-08-29",lte:"2026-10-23"};
  try{
    await connectWithPendingState(shop,property,"snapshot-refresh");
    await db.organicDailyMetric.createMany({data:[
      {shop,property,date:"2026-08-01",clicks:2,impressions:20,ctr:0.1,position:7},
      {shop:otherShop,property,date:"2026-10-02",clicks:9,impressions:90,ctr:0.1,position:6}
    ]});
    const run=(minute:number)=>syncOrganicMetrics(shop,new Date(Date.parse("2026-10-26T12:00:00Z")+minute*60_000));
    assert.equal((await run(0)).rows,2);
    assert.equal(await db.organicDailyMetric.count({where:{shop,date:currentDates}}),2);

    // Google's next successful date-only response no longer includes Oct 2.
    // It must not remain as a fabricated observed day in the growth baseline.
    rows=[day("2026-10-01")];
    assert.equal((await run(1)).rows,1);
    assert.deepEqual((await db.organicDailyMetric.findMany({
      where:{shop,date:currentDates},select:{date:true}
    })).map(r=>r.date),["2026-10-01"]);

    // Invalid Google responses must not erase the last valid snapshot.
    aggregationType="byPage";
    await assert.rejects(run(2),/aggregation type/);
    assert.equal(await db.organicDailyMetric.count({where:{shop,date:currentDates}}),1);
    aggregationType="byProperty";

    // A malformed HTTP 200 response must never be interpreted as an empty
    // snapshot and erase the last verified merchant observation.
    for(const malformed of [null,false,0,""]){
      rows=malformed;
      await assert.rejects(run(3),/Google Search Console rows array/);
      assert.equal(await db.organicDailyMetric.count({where:{shop,date:currentDates}}),1);
    }

    // A legitimate zero-row response removes all stale dates in the window,
    // but not older history or an unrelated tenant's same-property data.
    rows=[];
    assert.equal((await run(4)).rows,0);
    assert.equal(await db.organicDailyMetric.count({where:{shop,date:currentDates}}),0);
    // Google also legitimately omits the `rows` property for zero results.
    rows=undefined;
    assert.equal((await run(5)).rows,0);
    assert.equal(await db.organicDailyMetric.count({where:{shop,date:currentDates}}),0);
    assert.equal(await db.organicDailyMetric.count({where:{shop,date:"2026-08-01"}}),1);
    assert.equal(await db.organicDailyMetric.count({where:{shop:otherShop}}),1);

    // A date returned on a subsequent sync is restored normally.
    rows=[day("2026-10-02")];
    assert.equal((await run(6)).rows,1);
    assert.equal(await db.organicDailyMetric.count({where:{shop,date:currentDates}}),1);
  }finally{
    globalThis.fetch=originalFetch;
    await db.organicDailyMetric.deleteMany({where:{shop:{in:[shop,otherShop]}}});
    await db.searchConsoleConnection.deleteMany({where:{shop}});
    await db.googleAuthState.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
    for(const key of envKeys){
      if(previous[key]===undefined)delete process.env[key];
      else process.env[key]=previous[key];
    }
  }
});


test("Google reconnection resets old measurement history without affecting another merchant",async()=>{
  const previousKey=process.env.GSC_ENCRYPTION_KEY;
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,43).toString("base64");
  const shop="reconsent-"+randomUUID()+".myshopify.com";
  const neighbor="reconsent-neighbor-"+randomUUID()+".myshopify.com";
  const oldProperty="https://old.example.test/";
  const newProperty="https://new.example.test/";
  const staleDate=new Date("2026-10-01T00:00:00Z");
  try{
    await connectWithPendingState(shop,oldProperty,"refresh-old");
    await db.organicDailyMetric.createMany({data:[
      {shop,property:oldProperty,date:"2026-10-01",clicks:5,impressions:50,ctr:0.1,position:8},
      {shop,property:newProperty,date:"2026-10-02",clicks:3,impressions:30,ctr:0.1,position:9},
      {shop:neighbor,property:oldProperty,date:"2026-10-01",clicks:7,impressions:70,ctr:0.1,position:6}
    ]});
    await db.searchConsoleConnection.update({where:{shop},data:{
      lastSyncedAt:staleDate,lastSyncStartedAt:staleDate
    }});

    // Reconnecting with a different verified URL-prefix must not resurrect
    // historical rows if the merchant later switches back to the old host.
    await connectWithPendingState(shop,newProperty,"refresh-new");
    let connection=await db.searchConsoleConnection.findUniqueOrThrow({where:{shop}});
    assert.equal(connection.property,newProperty);
    assert.equal(connection.lastSyncedAt,null);
    assert.equal(connection.lastSyncStartedAt,null);
    assert.ok(connection.connectedAt.getTime()>staleDate.getTime());
    assert.equal(await db.organicDailyMetric.count({where:{shop}}),0);
    assert.equal(await db.organicDailyMetric.count({where:{shop:neighbor}}),1);

    // A failed/replayed OAuth state must not erase the new connection or data.
    await db.organicDailyMetric.create({data:{
      shop,property:newProperty,date:"2026-10-02",
      clicks:4,impressions:40,ctr:0.1,position:7
    }});
    await assert.rejects(
      storeGoogleConnection(shop,oldProperty,"invalid-refresh",randomUUID()),
      /expired or revoked/
    );
    connection=await db.searchConsoleConnection.findUniqueOrThrow({where:{shop}});
    assert.equal(connection.property,newProperty);
    assert.equal(await db.organicDailyMetric.count({where:{shop}}),1);

    // Reconsent for the same property also requires a fresh Google import.
    await connectWithPendingState(shop,newProperty,"refresh-again");
    assert.equal(await db.organicDailyMetric.count({where:{shop}}),0);
    assert.equal(await db.organicDailyMetric.count({where:{shop:neighbor}}),1);
  }finally{
    await db.organicDailyMetric.deleteMany({where:{shop:{in:[shop,neighbor]}}});
    await db.searchConsoleConnection.deleteMany({where:{shop:{in:[shop,neighbor]}}});
    await db.googleAuthState.deleteMany({where:{shop:{in:[shop,neighbor]}}});
    await db.storeConfig.deleteMany({where:{shop:{in:[shop,neighbor]}}});
    if(previousKey===undefined)delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY=previousKey;
  }
});
