import {test} from "node:test";
import assert from "node:assert/strict";
import {scopePilotCatalog} from "../app/lib/pilot-catalog-scope";
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
