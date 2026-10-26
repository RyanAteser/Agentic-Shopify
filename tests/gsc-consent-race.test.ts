import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {disconnectGoogle,storeGoogleConnection,syncOrganicMetrics} from "../app/lib/gsc.server";

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
      return Response.json({rows:[{
        keys:["2026-10-01"],clicks:5,impressions:50,ctr:0.1,position:8
      }]});
    }
    if(url==="https://oauth2.googleapis.com/revoke")return Response.json({});
    throw new Error("Unexpected external request: "+url);
  };
  try{
    await storeGoogleConnection(revokedShop,"sc-domain:example.test","refresh-token-1");
    pending=syncOrganicMetrics(revokedShop,new Date("2026-10-26T12:00:00Z"));
    await refreshStarted;
    await disconnectGoogle(revokedShop);
    releaseRefresh();
    await assert.rejects(pending,/consent or sync lease changed/);
    assert.equal(await db.searchConsoleConnection.count({where:{shop:revokedShop}}),0);
    assert.equal(await db.organicDailyMetric.count({where:{shop:revokedShop}}),0);

    // Positive control: the guard must not suppress legitimate imports.
    pauseRefresh=false;
    await storeGoogleConnection(activeShop,"sc-domain:example.test","refresh-token-2");
    const result=await syncOrganicMetrics(activeShop,new Date("2026-10-26T12:00:00Z"));
    assert.equal(result.rows,1);
    assert.equal(await db.organicDailyMetric.count({where:{shop:activeShop}}),1);
  }finally{
    releaseRefresh();
    await pending?.catch(()=>{});
    globalThis.fetch=originalFetch;
    await db.organicDailyMetric.deleteMany({where:{shop:{in:[revokedShop,activeShop]}}});
    await db.searchConsoleConnection.deleteMany({where:{shop:{in:[revokedShop,activeShop]}}});
    for(const key of envKeys){
      if(previous[key]===undefined)delete process.env[key];
      else process.env[key]=previous[key];
    }
  }
});
