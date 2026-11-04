import {test} from "node:test";
import assert from "node:assert/strict";
import {scopePilotCatalog,catalogAuditConclusion,catalogFindingDisplay} from "../app/lib/pilot-catalog-scope";
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
test("pilot abstains on primary-host pages that are not Shopify product routes",()=>{
  const urls = [
    "https://shop.example.com/",
    "https://shop.example.com/collections/sale",
    "https://shop.example.com/blogs/news/launch",
    "https://shop.example.com/products/",
    "https://shop.example.com/products/one/extra",
    "https://shop.example.com/products/%2Fadmin",
    "https://shop.example.com/en/products/one",
    "https://shop.example.com/en-US/products/two",
    "https://shop.example.com/products/three"
  ];
  assert.deepEqual(scopePilotCatalog(urls.map(product),"shop.example.com").eligible.map(p=>p.url),[
    "https://shop.example.com/en/products/one",
    "https://shop.example.com/en-US/products/two",
    "https://shop.example.com/products/three"
  ]);
  assert.match(catalogAuditConclusion({sampled:urls.length,eligible:3,findings:0,hasMore:false}),/Excluded or unsampled pages/);
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

test("pilot abstains on duplicate verified product URLs rather than double-count SEO findings",()=>{
  const url="https://shop.example.com/products/one";
  const first=product(url);
  const second={...product(url),id:"gid://shopify/Product/2",title:"Another product"};
  assert.throws(()=>scopePilotCatalog([first,second],"shop.example.com"),/Duplicate Shopify primary-storefront product URL/);
  assert.deepEqual(scopePilotCatalog([first,product("https://shop.example.com/products/two")],
    "shop.example.com").eligible.map(p=>p.url),[url,"https://shop.example.com/products/two"]);
  // An off-domain duplicate does not enter the eligible page denominator.
  assert.equal(scopePilotCatalog([first,product("https://other.example.com/products/one"),
    product("https://other.example.com/products/one")],"shop.example.com").eligible.length,1);
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

test("bounded SEO findings disclose omissions without changing total counts",()=>{
  assert.deepEqual(catalogFindingDisplay(0),{displayed:0,omitted:0,notice:""});
  assert.deepEqual(catalogFindingDisplay(25),{displayed:25,omitted:0,notice:""});
  const over=catalogFindingDisplay(31);
  assert.equal(over.displayed,25);
  assert.equal(over.omitted,6);
  assert.match(over.notice,/Showing 25 of 31/);
  assert.match(over.notice,/6 additional finding/);
  assert.equal(catalogFindingDisplay(8,3).omitted,5);
  for(const [total,limit] of [[-1,25],[NaN,25],[4,0],[4,1.5]]) {
    assert.throws(()=>catalogFindingDisplay(total,limit),/Invalid catalog finding display bounds/);
  }
});
