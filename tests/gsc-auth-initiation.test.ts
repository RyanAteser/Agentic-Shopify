import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import db from "../app/db.server";
import {beginGoogleAuthorization,nextGoogleConsentOrder,databaseConsentTime,disconnectGoogle,storeGoogleConnection} from "../app/lib/gsc.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";

const shopName=()=> "gsc-init-" + randomUUID() + ".myshopify.com";
const state=(value:string)=>createHash("sha256").update(value).digest("hex");
const createSession=(shop:string,id:string)=>db.session.create({
  data:{id,shop,state:"",accessToken:"test-only"}
});
// Tests capture explicit order before simulated slow authentication when needed.
async function begin(shop:string,sessionId:string,hash:string,order?:bigint){
  return beginGoogleAuthorization(shop,sessionId,hash,order??await nextGoogleConsentOrder());
}

test("GSC consent clock comes from the database, not a skewed worker",async()=>{
  const shop=shopName(),sessionId="session-"+randomUUID();
  const originalNow=Date.now;
  try{
    await createSession(shop,sessionId);
    const before=await databaseConsentTime();
    const oldOrder=await nextGoogleConsentOrder();
    // A worker can have a badly skewed clock without changing the
    // shared database time used by both Connect and Disconnect.
    Date.now=()=>originalNow()+24*60*60*1000;
    const sampled=await databaseConsentTime();
    assert.ok(Math.abs(sampled.getTime()-before.getTime())<30_000,
      "database consent time must ignore a 24-hour worker-clock skew");
    await disconnectGoogle(shop);
    const revoked=(await db.storeConfig.findUniqueOrThrow({where:{shop}})).gscConsentRevokedAt;
    const after=await databaseConsentTime();
    assert.ok(revoked&&revoked.getTime()>=before.getTime()&&revoked.getTime()<=after.getTime(),
      "revocation is sampled after the merchant lock on the database clock");
    assert.equal(await begin(shop,sessionId,state("skewed-worker"),oldOrder),"revoked");
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
  }finally{
    Date.now=originalNow;
    await eraseMerchantData(shop);
  }
});

test("GSC initiation requires a persisted, same-shop session and bounds pending consent",async()=>{
  const shop=shopName(),other=shopName(),sessionId="session-"+randomUUID();
  const oldOrder=await nextGoogleConsentOrder();
  try{
    assert.equal(await begin(shop,sessionId,state("missing"),oldOrder),"session_missing");
    assert.equal(await db.storeConfig.count({where:{shop}}),0);
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    await createSession(other,sessionId);
    assert.equal(await begin(shop,sessionId,state("wrong-shop"),oldOrder),"session_missing");
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    await createSession(shop,"valid-"+randomUUID());
    const own=(await db.session.findFirstOrThrow({where:{shop}})).id;
    for(let i=0;i<3;i++){
      assert.equal(await begin(shop,own,state("attempt-"+i),oldOrder),"created");
    }
    assert.equal(await begin(shop,own,state("fourth"),oldOrder),"rate_limited");
    assert.equal(await db.googleAuthState.count({where:{shop}}),3);
    assert.equal(await db.storeConfig.count({where:{shop}}),1);
    await disconnectGoogle(shop);
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    assert.equal(await db.storeConfig.count({where:{shop}}),1);
    const revoked=await db.storeConfig.findUniqueOrThrow({where:{shop}});
    assert.ok(revoked.gscConsentRevokedAt,"explicit disconnect must persist a revocation timestamp");
    assert.ok(revoked.gscConsentRevokedOrder>oldOrder,"disconnect advances the monotonic order");
    assert.equal(await begin(shop,own,state("stale"),oldOrder),"revoked");
    assert.equal(await begin(shop,own,state("fresh"),
      await nextGoogleConsentOrder()),"created",
      "a new explicit consent request remains possible while installed");
  }finally{
    await eraseMerchantData(shop);
    await eraseMerchantData(other);
  }
});

test("uninstall fences delayed Google consent initiation and finalization",async()=>{
  const shop=shopName(),sessionId="session-"+randomUUID();
  const previousKey=process.env.GSC_ENCRYPTION_KEY;
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,53).toString("base64");
  const hash=state("before-uninstall-"+randomUUID());
  try{
    await createSession(shop,sessionId);
    assert.equal(await begin(shop,sessionId,hash),"created");
    await eraseMerchantData(shop);
    assert.equal(await begin(shop,sessionId,state("late")),"session_missing");
    assert.equal(await db.storeConfig.count({where:{shop}}),0);
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),0);

    // Even a synthetically injected orphaned state cannot reattach a Google
    // refresh credential after Shopify has erased this merchant.
    const orphan=state("orphan-"+randomUUID());
    await db.googleAuthState.create({
      data:{shop,stateHash:orphan,expiresAt:new Date(Date.now()+60_000)}
    });
    await assert.rejects(
      storeGoogleConnection(shop,"https://example.test/","secret-refresh",orphan),
      /no longer connected/
    );
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),0);
  }finally{
    await eraseMerchantData(shop);
    if(previousKey===undefined)delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY=previousKey;
  }
});

test("active GSC consent finalizes once, then disconnect revokes pending states",async()=>{
  const shop=shopName(),sessionId="session-"+randomUUID();
  const originalFetch=globalThis.fetch;
  // Token revocation is an external best-effort call, never use a real
  // Google account or network connection in the test suite.
  globalThis.fetch=async()=>Response.json({});
  const previousKey=process.env.GSC_ENCRYPTION_KEY;
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,59).toString("base64");
  const hash=state("legitimate-"+randomUUID());
  try{
    await createSession(shop,sessionId);
    assert.equal(await begin(shop,sessionId,hash),"created");
    await storeGoogleConnection(shop,"https://example.test/","legitimate-refresh",hash);
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),1);
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    await assert.rejects(
      storeGoogleConnection(shop,"https://example.test/","replay",hash),/expired or revoked/
    );
    await disconnectGoogle(shop);
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),0);
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
  }finally{
    await eraseMerchantData(shop);
    globalThis.fetch=originalFetch;
    if(previousKey===undefined)delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY=previousKey;
  }
});

test("PostgreSQL GSC initiation and uninstall cannot leave orphaned consent",{
  skip:!process.env.DATABASE_URL
},async()=>{
  for(let round=0;round<4;round++){
    const shop=shopName(),sessionId="session-"+randomUUID();
    await createSession(shop,sessionId);
    try{
      const results=await Promise.allSettled([
        begin(shop,sessionId,state("race-"+randomUUID())),
        eraseMerchantData(shop)
      ]);
      assert.equal(results[0].status,"fulfilled");
      assert.equal(results[1].status,"fulfilled");
      assert.equal(await db.session.count({where:{shop}}),0);
      assert.equal(await db.storeConfig.count({where:{shop}}),0);
      assert.equal(await db.googleAuthState.count({where:{shop}}),0);
      assert.equal(await db.searchConsoleConnection.count({where:{shop}}),0);
    }finally{
      await eraseMerchantData(shop);
    }
  }
});

test("a delayed pre-disconnect Connect cannot reattach consent, but a new intent can",async()=>{
  const shop=shopName(),other=shopName(),sessionId="session-"+randomUUID();
  const otherSessionId="session-"+randomUUID();
  const previousKey=process.env.GSC_ENCRYPTION_KEY;
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,71).toString("base64");
  const startedOrder=await nextGoogleConsentOrder();
  const priorState=state("prior-"+randomUUID());
  try{
    await createSession(shop,sessionId);
    await createSession(other,otherSessionId);
    assert.equal(await begin(shop,sessionId,priorState,startedOrder),"created");
    await disconnectGoogle(shop);
    const config=await db.storeConfig.findUniqueOrThrow({where:{shop}});
    assert.ok(config.gscConsentRevokedAt);
    assert.ok(config.gscConsentRevokedOrder>startedOrder);
    assert.equal(await begin(shop,sessionId,state("delayed-"+randomUUID()),startedOrder),"revoked");
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    await assert.rejects(
      storeGoogleConnection(shop,"https://example.test/","replayed-token",priorState),
      /expired or revoked/
    );
    assert.equal(await db.searchConsoleConnection.count({where:{shop}}),0);
    assert.equal(await begin(other,otherSessionId,state("neighbor-"+randomUUID())),"created",
      "revocation is scoped to the merchant");
    assert.equal(await begin(shop,sessionId,state("new-"+randomUUID()),
      await nextGoogleConsentOrder()),"created");
    assert.equal(await db.googleAuthState.count({where:{shop}}),1);
  }finally{
    await eraseMerchantData(shop);
    await eraseMerchantData(other);
    if(previousKey===undefined)delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY=previousKey;
  }
});

test("PostgreSQL concurrent Connect and Disconnect leave no stale state",{
  skip:!process.env.DATABASE_URL
},async()=>{
  for(let i=0;i<4;i++){
    const shop=shopName(),sessionId="session-"+randomUUID();
    await createSession(shop,sessionId);
    try{
      const startedOrder=await nextGoogleConsentOrder();
      const outcomes=await Promise.allSettled([
        begin(shop,sessionId,state("race-"+randomUUID()),startedOrder),
        disconnectGoogle(shop)
      ]);
      assert.equal(outcomes[0].status,"fulfilled");
      assert.equal(outcomes[1].status,"fulfilled");
      assert.equal(await db.googleAuthState.count({where:{shop}}),0);
      assert.equal(await db.searchConsoleConnection.count({where:{shop}}),0);
      assert.ok((await db.storeConfig.findUniqueOrThrow({where:{shop}})).gscConsentRevokedAt);
    }finally{
      await eraseMerchantData(shop);
    }
  }
});
