import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import db from "../app/db.server";
import {beginGoogleAuthorization,disconnectGoogle,storeGoogleConnection} from "../app/lib/gsc.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";

const shopName=()=> "gsc-init-" + randomUUID() + ".myshopify.com";
const state=(value:string)=>createHash("sha256").update(value).digest("hex");
const createSession=(shop:string,id:string)=>db.session.create({
  data:{id,shop,state:"",accessToken:"test-only"}
});

test("GSC initiation requires a persisted, same-shop session and bounds pending consent",async()=>{
  const shop=shopName(),other=shopName(),sessionId="session-"+randomUUID();
  const now=new Date("2026-10-29T12:00:00Z");
  try{
    assert.equal(await beginGoogleAuthorization(shop,sessionId,state("missing"),now),"session_missing");
    assert.equal(await db.storeConfig.count({where:{shop}}),0);
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    await createSession(other,sessionId);
    assert.equal(await beginGoogleAuthorization(shop,sessionId,state("wrong-shop"),now),"session_missing");
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    await createSession(shop,"valid-"+randomUUID());
    const own=(await db.session.findFirstOrThrow({where:{shop}})).id;
    for(let i=0;i<3;i++){
      assert.equal(await beginGoogleAuthorization(shop,own,state("attempt-"+i),now),"created");
    }
    assert.equal(await beginGoogleAuthorization(shop,own,state("fourth"),now),"rate_limited");
    assert.equal(await db.googleAuthState.count({where:{shop}}),3);
    assert.equal(await db.storeConfig.count({where:{shop}}),1);
    await disconnectGoogle(shop);
    assert.equal(await db.googleAuthState.count({where:{shop}}),0);
    assert.equal(await db.storeConfig.count({where:{shop}}),1);
    assert.equal(await beginGoogleAuthorization(shop,own,state("fresh"),now),"created",
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
    assert.equal(await beginGoogleAuthorization(shop,sessionId,hash),"created");
    await eraseMerchantData(shop);
    assert.equal(await beginGoogleAuthorization(shop,sessionId,state("late")),"session_missing");
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
    assert.equal(await beginGoogleAuthorization(shop,sessionId,hash),"created");
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
        beginGoogleAuthorization(shop,sessionId,state("race-"+randomUUID())),
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
