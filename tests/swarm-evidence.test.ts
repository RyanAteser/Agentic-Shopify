import {test} from "node:test";
import assert from "node:assert/strict";
import {
  captureVerifiedShopifySnapshot,requireVerifiedShopifySnapshot,
  SHOPIFY_EVIDENCE_SENDER,SNAPSHOT_SOURCE
} from "../app/lib/swarm-evidence.server";

const shop="artemisti.myshopify.com";
const now=new Date("2026-11-06T20:00:00.000Z");
const all=[...Array.from({length:16},()=>({status:"ACTIVE",onlineStoreUrl:null})),
  {status:"ARCHIVED",onlineStoreUrl:null},{status:"DRAFT",onlineStoreUrl:null}];
const published=Array.from({length:13},()=>({status:"ACTIVE",onlineStoreUrl:null}));
function admin(data:unknown,queries:string[]=[]){
  return {graphql:async(q:string)=>{
    queries.push(q);
    return {json:async()=>data};
  }};
}

test("read-only Shopify snapshot preserves actual store facts with no product payloads",async()=>{
  const queried:string[]=[];
  const s=await captureVerifiedShopifySnapshot(admin({
    data:{
      shop:{myshopifyDomain:shop},
      onlineStore:{passwordProtection:{enabled:true}},
      all:{nodes:all,pageInfo:{hasNextPage:false}},
      published:{nodes:published,pageInfo:{hasNextPage:false}}
    }
  },queried),shop,now);
  assert.equal(s.source,SNAPSHOT_SOURCE);
  assert.equal(s.shop,shop);
  assert.equal(s.storefrontPasswordEnabled,true);
  assert.equal(s.allProductsSampled,18);
  assert.equal(s.activeProductsInSample,16);
  assert.equal(s.publishedProductsSampled,13);
  assert.equal(s.publishedProductsWithOnlineStoreUrl,0);
  assert.equal(s.collectedAt,now.toISOString());
  assert.equal(queried.length,1);
  assert.match(queried[0],/passwordProtection\s*\{\s*enabled/);
  assert.match(queried[0],/published_status:published/);
  assert.doesNotMatch(JSON.stringify(s),/accessToken|productId|title|customer|email/);
  assert.equal(SHOPIFY_EVIDENCE_SENDER,"shopify-admin-verified-snapshot");
  assert.deepEqual(requireVerifiedShopifySnapshot(s,shop,now),s);
});

test("stale, mismatched and fabricated snapshot records fail closed",()=>{
  const base={
    source:SNAPSHOT_SOURCE,shop,collectedAt:now.toISOString(),
    storefrontPasswordEnabled:true,allProductsSampled:18,
    allProductsHasNextPage:false,activeProductsInSample:16,
    allProductsWithOnlineStoreUrl:0,publishedProductsSampled:13,
    publishedProductsHasNextPage:false,publishedActiveProductsInSample:13,
    publishedProductsWithOnlineStoreUrl:0
  };
  for(const value of [
    {...base,shop:"other.myshopify.com"},
    {...base,source:"model-assertion"},
    {...base,collectedAt:"2026-11-04T20:00:00.000Z"},
    {...base,collectedAt:"invalid"},
    {...base,allProductsSampled:2},
    {...base,storefrontPasswordEnabled:"true"},
    {...base,publishedProductsSampled:90}
  ])assert.throws(()=>requireVerifiedShopifySnapshot(value,shop,now));
});

test("GraphQL identity mismatch or missing password field cannot create evidence",async()=>{
  const wrong={data:{
    shop:{myshopifyDomain:"other.myshopify.com"},
    onlineStore:{passwordProtection:{enabled:true}},
    all:{nodes:all,pageInfo:{hasNextPage:false}},
    published:{nodes:published,pageInfo:{hasNextPage:false}}
  }};
  await assert.rejects(captureVerifiedShopifySnapshot(admin(wrong),shop,now));
  const noPassword={data:{...wrong.data,shop:{myshopifyDomain:shop},
    onlineStore:{passwordProtection:{}}}};
  await assert.rejects(captureVerifiedShopifySnapshot(admin(noPassword),shop,now));
  await assert.rejects(captureVerifiedShopifySnapshot(
    {graphql:async()=>{throw new Error("merchant secrets must not be echoed")}},shop,now),
  (error:unknown)=>error instanceof Error &&
    !error.message.includes("merchant secrets"));
});
