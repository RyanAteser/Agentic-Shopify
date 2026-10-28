import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRanking, auditProductSeo, assertRankingTargetsForPrimaryDomain, assertUniqueRankingObservations } from "../app/lib/seo";

const now = new Date("2026-10-24T12:00:00.000Z");
const context = {engine:"google",country:"US",device:"desktop"} as const;
test("SERP rank record retains source, country, device and observation time", () => {
  const a = parseRanking({...context,keyword:"  Running Shoes ",position:4,country:"US",device:"mobile",
    observedAt:"2026-10-24T11:00:00.000Z",targetUrl:"https://example.com/shoes"},now);
  assert.equal(a.keyword,"running shoes");
  assert.equal(a.position,4);
  assert.equal(a.source,"brightdata-serp");
  assert.equal(a.device,"mobile");
  const b = parseRanking({...context,keyword:"running shoes",position:null,observedAt:"2026-10-24T11:00:00.000Z"},now);
  assert.equal(b.position,null);
});
test("reject invalid ranks, unsafe URLs, and future observations", () => {
  for(const input of [
    {keyword:"test",position:0,observedAt:now.toISOString()},
    {keyword:"test",position:-2,observedAt:now.toISOString()},
    {keyword:"test",position:2.5,observedAt:now.toISOString()},
    {keyword:"test",position:7,observedAt:"2026-11-24T00:00:00.000Z"},
    {keyword:"test",position:3,observedAt:now.toISOString(),targetUrl:"javascript:alert(1)"}
  ]) assert.throws(()=>parseRanking(input,now));
});
test("metadata audit detects blank descriptions and duplicate titles without mutating products", () => {
  const products=[
    {id:"1",title:"Sample",url:"https://example.com/a",description:"",seo:{title:"Same",description:null}},
    {id:"2",title:"Sample2",url:"https://example.com/b",description:"hello",seo:{title:"Same",description:"Valid meta"}}
  ];
  const findings=auditProductSeo(products);
  assert.ok(findings.some(x=>x.kind==="missing-description"));
  assert.ok(findings.some(x=>x.kind==="duplicate-title"));
  assert.equal(products[0].seo.title,"Same");
});

test("Shopify description fallback prevents false missing-meta alerts and arbitrary length warnings", () => {
  const products = [
    {id:"fallback",title:"Useful product",url:"https://example.com/fallback",
      description:"A specific, useful description of this product and its features.",seo:{title:null,description:null}},
    {id:"empty",title:"No description",url:"https://example.com/empty",
      description:"  ",seo:{title:null,description:null}},
    {id:"custom200",title:"Custom 200",url:"https://example.com/200",
      description:"",seo:{title:null,description:"a".repeat(200)}},
    {id:"custom321",title:"Custom 321",url:"https://example.com/321",
      description:"",seo:{title:null,description:"b".repeat(321)}},
  ];
  const findings = auditProductSeo(products);
  assert.equal(findings.filter(f=>f.productId==="fallback").length,0,
    "Shopify's product description is the default meta description");
  assert.equal(findings.find(f=>f.productId==="empty")?.kind,"missing-description");
  assert.equal(findings.find(f=>f.productId==="empty")?.severity,"high");
  assert.equal(findings.filter(f=>f.productId==="custom200").length,0,
    "Google has no 165-character meta-description limit");
  assert.equal(findings.find(f=>f.productId==="custom321")?.kind,"long-description");
  assert.equal(findings.find(f=>f.productId==="custom321")?.severity,"medium");
});


test("SERP target URLs must belong to Shopify's verified primary domain", () => {
  const found = parseRanking({...context,keyword:"boots",position:5,observedAt:now.toISOString(),
    targetUrl:"https://www.store.example/products/boots"},now);
  assert.doesNotThrow(() => assertRankingTargetsForPrimaryDomain([found], "www.store.example"));
  const absent = parseRanking({...context,keyword:"boots",position:null,observedAt:now.toISOString()},now);
  assert.doesNotThrow(() => assertRankingTargetsForPrimaryDomain([absent], "www.store.example"));
  for (const url of [
    "https://store.example/products/boots",
    "https://competitor.example/products/boots",
    "https://www.store.example.attacker.test/products/boots",
    "https://blog.www.store.example/products/boots",
    "https://www.store.example./products/boots"
  ]) {
    const row = parseRanking({...context,keyword:"boots",position:5,observedAt:now.toISOString(),targetUrl:url},now);
    assert.throws(() => assertRankingTargetsForPrimaryDomain([row],"www.store.example"), url);
  }
  assert.throws(() => parseRanking({...context,keyword:"boots",position:5,observedAt:now.toISOString(),
    targetUrl:"https://www.store.example@attacker.test/products/boots"},now), /credentials/);
  assert.throws(() => assertRankingTargetsForPrimaryDomain([{...found,targetUrl:""}],"www.store.example"));
  assert.throws(() => assertRankingTargetsForPrimaryDomain([{...absent,targetUrl:found.targetUrl}],"www.store.example"));
  assert.throws(() => assertRankingTargetsForPrimaryDomain([found],"https://www.store.example"));
});


test("SERP import rejects omitted market context rather than silently labeling US desktop Google", () => {
  const valid: Record<string, unknown> = {
    ...context, keyword:"boots", position:5,
    targetUrl:"https://shop.example/boots", observedAt:now.toISOString()
  };
  for (const missing of ["engine", "country", "device"]) {
    const row = {...valid};
    delete row[missing];
    assert.throws(() => parseRanking(row, now), missing);
  }
  assert.equal(parseRanking(valid, now).country, "US");
});

test("SERP timestamps require an explicit offset and a real calendar date", () => {
  const valid = {
    ...context, keyword:"boots", position:5,
    targetUrl:"https://shop.example/boots"
  };
  for (const observedAt of [
    "2026-10-24T11:00:00",
    "2026-10-24",
    "2026-02-30T11:00:00Z",
    "2026-10-24T11:00:00+14:30",
    "2026-10-24T11:00:00+15:00",
    "2026-10-24T25:00:00Z"
  ]) {
    assert.throws(() => parseRanking({...valid, observedAt}, now), observedAt);
  }
  const offset = parseRanking({...valid, observedAt:"2026-10-24T13:00:00+02:00"}, now);
  assert.equal(offset.observedAt.toISOString(), "2026-10-24T11:00:00.000Z");
  assert.equal(parseRanking({...valid, observedAt:"2024-02-29T11:00:00Z"},
    new Date("2024-02-29T12:00:00Z")).observedAt.toISOString(), "2024-02-29T11:00:00.000Z");
});

test("duplicate same-market SERP snapshots are rejected before last-write-wins upsert", () => {
  const base = parseRanking({...context,keyword:"boots",position:4,
    observedAt:now.toISOString(),targetUrl:"https://shop.example/boots"},now);
  assert.throws(() => assertUniqueRankingObservations([base,{...base,position:9}]), /Duplicate/);
  assert.doesNotThrow(() => assertUniqueRankingObservations([
    base, {...base,device:"mobile"}, {...base,observedAt:new Date(now.getTime()-60_000)}
  ]));
});
