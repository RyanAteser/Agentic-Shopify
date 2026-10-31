import {test} from "node:test";
import assert from "node:assert/strict";
import {assertPropertyAggregation,gscReportingWindow,isExactHttpsStorefrontProperty,matchesPrimaryDomain,parseSearchConsoleRows,compareOrganicWindows} from "../app/lib/growth";
import {encryptToken,decryptToken,randomOAuthState,hashState} from "../app/lib/gsc-crypto.server";

test("Search Console OAuth property must match Shopify primary host",()=>{
  assert.equal(matchesPrimaryDomain("https://store.example.com/","store.example.com"),true);
  assert.equal(matchesPrimaryDomain("sc-domain:example.com","store.example.com"),false);
  assert.equal(matchesPrimaryDomain("sc-domain:store.example.com","store.example.com"),false);
  assert.equal(isExactHttpsStorefrontProperty("https://store.example.com/"),true);
  for(const broadOrInvalid of [
    "sc-domain:example.com","sc-domain:store.example.com",
    "http://store.example.com/","https://store.example.com/products/",
    "https://store.example.com/?q=1","https://store.example.com/#fragment",
    "https://store.example.com:443/","https://store.example.com.evil.test/"
  ]) {
    // The evil host is syntactically a valid property but not this merchant's.
    if(!broadOrInvalid.includes(".evil.test"))assert.equal(isExactHttpsStorefrontProperty(broadOrInvalid),false);
    assert.equal(matchesPrimaryDomain(broadOrInvalid,"store.example.com"),false);
  }
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
test("GSC rejects malformed dates, wrong dimensions and fabricated zero metrics",()=>{
  const start="2026-02-01",end="2026-03-31";
  const good={keys:["2026-02-12"],clicks:3,impressions:20,ctr:0.15,position:6.2};
  const parse=(row:unknown)=>parseSearchConsoleRows([row],start,end);
  assert.deepEqual(parse(good)[0],{date:"2026-02-12",clicks:3,impressions:20,ctr:0.15,position:6.2});
  for(const invalid of [
    {...good,keys:["2026-02-30"]}, // lexically valid, impossible calendar day
    {...good,keys:["2026-02-12","MOBILE"]}, // page/device cohort, not date-only
    {...good,clicks:null}, {...good,impressions:"20"},
    {...good,ctr:0.5}, // clicks/impressions must agree with reported CTR
    {...good,position:0}, // positive impressions require a real rank
    {...good,impressions:0,clicks:0,ctr:0,position:6.2},
    {...good,impressions:0,clicks:0,ctr:0,position:0,keys:[]},
  ]) assert.throws(()=>parse(invalid));
  // Google declares these as double values; preserve fractional precision.
  assert.equal(parse({...good,clicks:2.5,ctr:0.125})[0].clicks,2.5);
  assert.equal(parse({...good,ctr:0.1500004})[0].ctr,0.1500004);
});
test("GSC rejects a different response aggregation even with valid date rows",()=>{
  assert.doesNotThrow(()=>assertPropertyAggregation("byProperty"));
  for(const value of ["byPage","auto",null,undefined,"BY_PROPERTY"]){
    assert.throws(()=>assertPropertyAggregation(value),/aggregation type/);
  }
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
test("Google reporting window uses Pacific calendar dates around midnight and DST",()=>{
  const beforeMidnight=gscReportingWindow(new Date("2026-10-26T06:30:00Z"));
  const afterMidnight=gscReportingWindow(new Date("2026-10-26T07:30:00Z"));
  assert.deepEqual(beforeMidnight,{startDate:"2026-08-28",endDate:"2026-10-22"});
  assert.deepEqual(afterMidnight,{startDate:"2026-08-29",endDate:"2026-10-23"});
  // The fall DST transition repeats 01:30 locally; both instants are Nov 1.
  assert.equal(gscReportingWindow(new Date("2026-11-01T08:30:00Z")).endDate,"2026-10-29");
  assert.equal(gscReportingWindow(new Date("2026-11-01T09:30:00Z")).endDate,"2026-10-29");
  const before=compareOrganicWindows([],new Date("2026-10-26T06:30:00Z"));
  const after=compareOrganicWindows([],new Date("2026-10-26T07:30:00Z"));
  assert.equal(before.comparable,false);
  assert.equal(after.comparable,false);
});
test("growth scorecard abstains rather than inflating 28-day totals on missing dates",()=>{
  const now=new Date("2026-10-26T12:00:00Z");
  const start=Date.parse("2026-08-29T00:00:00Z");
  const full=Array.from({length:56},(_,i)=>({
    date:new Date(start+i*86400000).toISOString().slice(0,10),
    clicks:i>=28?20:10,impressions:100,ctr:i>=28?0.2:0.1,position:10
  }));
  const missingCurrent=compareOrganicWindows(full.filter((_,i)=>i!==55),now);
  assert.equal(missingCurrent.current.days,27);
  assert.equal(missingCurrent.comparable,false);
  assert.equal(missingCurrent.clicksChangePct,null);
  const missingPrevious=compareOrganicWindows(full.filter((_,i)=>i!==1),now);
  assert.equal(missingPrevious.previous.days,27);
  assert.equal(missingPrevious.impressionsChangePct,null);
  const duplicate=compareOrganicWindows([...full,full[0]],now);
  assert.equal(duplicate.comparable,false);
  const observedZero=full.map((r,i)=>i===55?{...r,clicks:0,impressions:0,ctr:0,position:0}:r);
  assert.equal(compareOrganicWindows(observedZero,now).comparable,true);
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

test("GSC symmetric click decomposition reconciles exactly and identifies offsetting drivers",()=>{
  const now=new Date("2026-10-26T12:00:00Z");
  const start=Date.parse("2026-08-29T00:00:00Z");
  const rows=Array.from({length:56},(_,i)=>{
    const current=i>=28;
    const impressions=current?200:100,clicks=current?10:20;
    return {date:new Date(start+i*86400000).toISOString().slice(0,10),
      clicks,impressions,ctr:clicks/impressions,position:8};
  });
  const r=compareOrganicWindows(rows,now);
  assert.equal(r.comparable,true);
  assert.equal(r.current.clicks-r.previous.clicks,-280);
  assert.equal(r.clickChangeDrivers?.ctrChangePercentagePoints,-15);
  assert.ok((r.clickChangeDrivers?.impressionEffectClicks??0)>0);
  assert.ok((r.clickChangeDrivers?.ctrEffectClicks??0)<0);
  assert.ok(Math.abs((r.clickChangeDrivers!.impressionEffectClicks+
    r.clickChangeDrivers!.ctrEffectClicks)-(r.current.clicks-r.previous.clicks))<1e-8);
});
test("GSC click decomposition abstains on incomplete or zero-impression windows",()=>{
  const now=new Date("2026-10-26T12:00:00Z");
  const start=Date.parse("2026-08-29T00:00:00Z");
  const rows=Array.from({length:56},(_,i)=>({
    date:new Date(start+i*86400000).toISOString().slice(0,10),
    clicks:i>=28?2:0,impressions:i>=28?20:0,ctr:i>=28?0.1:0,position:i>=28?7:0
  }));
  assert.equal(compareOrganicWindows(rows,now).clickChangeDrivers,null);
  assert.equal(compareOrganicWindows(rows.slice(1),now).clickChangeDrivers,null);
  const normal=rows.map(x=>({...x,clicks:2,impressions:20,ctr:0.1,position:7}));
  const r=compareOrganicWindows(normal,now);
  assert.deepEqual(r.clickChangeDrivers,{
    impressionEffectClicks:0,ctrEffectClicks:0,ctrChangePercentagePoints:0
  });
});
