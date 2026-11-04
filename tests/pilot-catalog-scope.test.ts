import {test} from "node:test";
import assert from "node:assert/strict";
import {scopePilotCatalog,catalogAuditConclusion} from "../app/lib/pilot-catalog-scope";
import type {SeoProduct} from "../app/lib/seo";

const product = (url:string|null):SeoProduct => ({
  id:"gid://shopify/Product/1", title:"Example", description:"Example",
  url, seo:{title:null,description:null}
});

test("pilot only audits exact Shopify-attested primary host",()=>{
  const sample = [
    product("https://shop.example.com/products/one"),
    product("https://other.example.com/products/two"),
    product("https://shop.example.com.evil.test/products/three"),
    product("https://shop.example.com:8443/products/four"),
    product("https://user:pass@shop.example.com/products/five"),
    product("http://shop.example.com/products/six"),
    product("https://shop.example.com/products/seven?ref=other"),
    product(null),
  ];
  const result=scopePilotCatalog(sample,"shop.example.com");
  assert.deepEqual(result.eligible.map(p=>p.url),["https://shop.example.com/products/one"]);
  assert.equal(result.excludedForeign,2);
});
test("pilot rejects invalid or unverified primary domain",()=>{
  for(const host of ["","localhost","shop.example.com.evil..test","https://shop.example.com","127.0.0.1","shop.example.com/other"]){
    assert.throws(()=>scopePilotCatalog([product("https://shop.example.com/products/one")],host));
  }
});
test("pilot permits valid alternate Shopify domain only when attested",()=>{
  const url="https://monikablunderbeauty.com/products/cream";
  assert.deepEqual(scopePilotCatalog([product(url)],"monikablunderbeauty.com").eligible.map(p=>p.url),[url]);
  assert.equal(scopePilotCatalog([product(url)],"other.example.com").eligible.length,0);
});

test("pilot abstains when no eligible products were actually audited",()=>{
  assert.match(catalogAuditConclusion({sampled:13,eligible:0,findings:0,hasMore:false}),/No SEO audit was performed/);
  assert.match(catalogAuditConclusion({sampled:0,eligible:0,findings:0,hasMore:false}),/No SEO audit was performed/);
  assert.doesNotMatch(catalogAuditConclusion({sampled:13,eligible:0,findings:0,hasMore:false}),/No issues detected/);
});
test("pilot qualifies clean findings by verified coverage",()=>{
  assert.match(catalogAuditConclusion({sampled:13,eligible:5,findings:0,hasMore:false}),/Excluded or unsampled pages/);
  assert.match(catalogAuditConclusion({sampled:100,eligible:100,findings:0,hasMore:true}),/Excluded or unsampled pages/);
  assert.match(catalogAuditConclusion({sampled:5,eligible:5,findings:0,hasMore:false}),/not proof of Google indexing/);
  assert.match(catalogAuditConclusion({sampled:5,eligible:5,findings:2,hasMore:false}),/2 potential SEO issue/);
});
test("pilot rejects impossible audit coverage instead of a clean verdict",()=>{
  for(const input of [
    {sampled:1,eligible:2,findings:0,hasMore:false},
    {sampled:1,eligible:-1,findings:0,hasMore:false},
    {sampled:NaN,eligible:0,findings:0,hasMore:false},
    {sampled:1,eligible:1,findings:-1,hasMore:false}
  ])assert.throws(()=>catalogAuditConclusion(input),/Invalid catalog audit coverage/);
});
