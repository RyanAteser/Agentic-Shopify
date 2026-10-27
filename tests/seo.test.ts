import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRanking, auditProductSeo, assertRankingTargetsForPrimaryDomain } from "../app/lib/seo";

const now = new Date("2026-10-24T12:00:00.000Z");
test("SERP rank record retains source, country, device and observation time", () => {
  const a = parseRanking({keyword:"  Running Shoes ",position:4,country:"US",device:"mobile",
    observedAt:"2026-10-24T11:00:00.000Z",targetUrl:"https://example.com/shoes"},now);
  assert.equal(a.keyword,"running shoes");
  assert.equal(a.position,4);
  assert.equal(a.source,"brightdata-serp");
  assert.equal(a.device,"mobile");
  const b = parseRanking({keyword:"running shoes",position:null,observedAt:"2026-10-24T11:00:00.000Z"},now);
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
    {id:"1",title:"Sample",url:"https://example.com/a",description:"hello",seo:{title:"Same",description:null}},
    {id:"2",title:"Sample2",url:"https://example.com/b",description:"hello",seo:{title:"Same",description:"Valid meta"}}
  ];
  const findings=auditProductSeo(products);
  assert.ok(findings.some(x=>x.kind==="missing-description"));
  assert.ok(findings.some(x=>x.kind==="duplicate-title"));
  assert.equal(products[0].seo.title,"Same");
});


test("SERP target URLs must belong to Shopify's verified primary domain", () => {
  const found = parseRanking({keyword:"boots",position:5,observedAt:now.toISOString(),
    targetUrl:"https://www.store.example/products/boots"},now);
  assert.doesNotThrow(() => assertRankingTargetsForPrimaryDomain([found], "www.store.example"));
  const absent = parseRanking({keyword:"boots",position:null,observedAt:now.toISOString()},now);
  assert.doesNotThrow(() => assertRankingTargetsForPrimaryDomain([absent], "www.store.example"));
  for (const url of [
    "https://store.example/products/boots",
    "https://competitor.example/products/boots",
    "https://www.store.example.attacker.test/products/boots",
    "https://blog.www.store.example/products/boots",
    "https://www.store.example./products/boots"
  ]) {
    const row = parseRanking({keyword:"boots",position:5,observedAt:now.toISOString(),targetUrl:url},now);
    assert.throws(() => assertRankingTargetsForPrimaryDomain([row],"www.store.example"), url);
  }
  assert.throws(() => parseRanking({keyword:"boots",position:5,observedAt:now.toISOString(),
    targetUrl:"https://www.store.example@attacker.test/products/boots"},now), /credentials/);
  assert.throws(() => assertRankingTargetsForPrimaryDomain([{...found,targetUrl:""}],"www.store.example"));
  assert.throws(() => assertRankingTargetsForPrimaryDomain([{...absent,targetUrl:found.targetUrl}],"www.store.example"));
  assert.throws(() => assertRankingTargetsForPrimaryDomain([found],"https://www.store.example"));
});
