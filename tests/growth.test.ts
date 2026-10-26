import {test} from "node:test";
import assert from "node:assert/strict";
import {matchesPrimaryDomain,parseSearchConsoleRows,compareOrganicWindows} from "../app/lib/growth";
import {encryptToken,decryptToken,randomOAuthState,hashState} from "../app/lib/gsc-crypto.server";

test("Search Console OAuth property must match Shopify primary host",()=>{
  assert.equal(matchesPrimaryDomain("https://store.example.com/","store.example.com"),true);
  assert.equal(matchesPrimaryDomain("sc-domain:example.com","store.example.com"),true);
  assert.equal(matchesPrimaryDomain("https://competitor.example.com/","store.example.com"),false);
  assert.equal(matchesPrimaryDomain("sc-domain:attacker.com","store.example.com"),false);
  assert.equal(matchesPrimaryDomain("https://store.example.com.evil.io/","store.example.com"),false);
  assert.equal(matchesPrimaryDomain("http://store.example.com/","store.example.com"),false);
  assert.equal(matchesPrimaryDomain("https://store.example.com/products","store.example.com"),false);
  assert.equal(matchesPrimaryDomain("sc-domain:myshopify.com","myshop.myshopify.com"),false);
});
test("Search Console daily observation parser validates dates and data provenance",()=>{
  const rows=parseSearchConsoleRows([
    {keys:["2026-10-01"],clicks:12,impressions:200,ctr:0.06,position:7.9},
    {keys:["2026-10-02"],clicks:0,impressions:0,ctr:0,position:0}
  ],"2026-10-01","2026-10-03");
  assert.equal(rows.length,2);
  assert.equal(rows[0].date,"2026-10-01");
  assert.throws(()=>parseSearchConsoleRows([{keys:["2026-10-01"],clicks:4,impressions:1,ctr:4,position:10}],"2026-10-01","2026-10-04"));
  assert.throws(()=>parseSearchConsoleRows([{keys:["2026-10-05"],clicks:0,impressions:0,ctr:0,position:0}],"2026-10-01","2026-10-04"));
  assert.throws(()=>parseSearchConsoleRows([{keys:["2026-10-01"],clicks:-1,impressions:0,ctr:0,position:0}],"2026-10-01","2026-10-04"));
});
test("28 day growth windows are observation based and refuse weak baselines",()=>{
  const now=new Date("2026-10-26T12:00:00Z");
  const start=new Date("2026-08-29T00:00:00Z"); // prior 56 completed days to Oct 23
  const metrics=Array.from({length:56},(_,i)=>{
    const date=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);
    return {date,clicks:i>=28?20:10,impressions:100,ctr:i>=28?0.2:0.1,position:10};
  });
  const a=compareOrganicWindows(metrics,now);
  assert.equal(a.comparable,true);
  assert.equal(a.clicksChangePct,100);
  assert.equal(a.current.clicks,560);
  assert.equal(a.previous.clicks,280);
  const weak=compareOrganicWindows(metrics.slice(0,20),now);
  assert.equal(weak.comparable,false);
  assert.equal(weak.clicksChangePct,null);
});
test("AES-GCM ciphertext roundtrip and tamper rejection",()=>{
  const previous=process.env.GSC_ENCRYPTION_KEY;
  process.env.GSC_ENCRYPTION_KEY=Buffer.alloc(32,17).toString("base64");
  try {
    const cipher=encryptToken("secret-offline-refresh");
    assert.equal(cipher.includes("secret-offline-refresh"),false);
    assert.equal(decryptToken(cipher),"secret-offline-refresh");
    const parts=cipher.split(".");
    parts[3]=Buffer.from("corrupted").toString("base64url");
    assert.throws(()=>decryptToken(parts.join(".")));
    const {raw,hash}=randomOAuthState();
    assert.equal(hash,hashState(raw));
  }finally{
    if(previous===undefined)delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY=previous;
  }
});
