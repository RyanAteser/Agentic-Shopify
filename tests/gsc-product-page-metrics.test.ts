import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gscPageQuery,parseGscPageResponse,selectGscProductUrls,MAX_GSC_PRODUCT_PAGES
} from "../app/lib/gsc-page-metrics";
import type { SeoProduct } from "../app/lib/seo";

const host="store.example.test";
const date="2026-10-20";
const start="2026-09-15",end="2026-11-01";
const url="https://store.example.test/products/product-one";
const item=(id:string,pageUrl:string|null):SeoProduct=>({
  id,title:id,description:"Test product",url:pageUrl,seo:{title:null,description:null}
});
const good={responseAggregationType:"byPage",rows:[
  {keys:[date,url],clicks:3,impressions:30,ctr:.1,position:5}
]};

test("page URL sample is exclusively authenticated Shopify's HTTPS primary host",()=>{
  const products=[
    item("1",url),item("2",null),
    item("3","https://monikablunderbeauty.com/products/not-this-merchant"),
    item("4","https://store.example.test/products/two?variant=123"),
    item("5","https://other.store.example.test/products/subdomain"),
    item("6","https://store.example.test/collections/other"),
    item("7","https://store.example.test/products/product-three")
  ];
  assert.deepEqual(selectGscProductUrls(products,host),[
    url,"https://store.example.test/products/product-three"
  ]);
  assert.throws(()=>selectGscProductUrls([item("1",url),item("2",url)],host),/duplicate/i);
  assert.throws(()=>selectGscProductUrls(products,host,MAX_GSC_PRODUCT_PAGES+1),/limit/i);
  assert.throws(()=>selectGscProductUrls(products,"localhost"),/primary host/i);
  const many=Array.from({length:20},(_,i)=>
    item("id"+i,`https://store.example.test/products/item-${i}`));
  assert.equal(selectGscProductUrls(many,host).length,MAX_GSC_PRODUCT_PAGES);
});

test("read-only Search Analytics query scopes exact canonical page, date and aggregation",()=>{
  assert.deepEqual(gscPageQuery(url,start,end),{
    startDate:start,endDate:end,dimensions:["date","page"],
    type:"web",dataState:"final",aggregationType:"byPage",
    dimensionFilterGroups:[{groupType:"and",filters:[{
      dimension:"page",operator:"equals",expression:url
    }]}],rowLimit:100,startRow:0
  });
});

test("page rows parse date, counts and matched URL without assuming missing zero days",()=>{
  const rows=parseGscPageResponse(good,url,start,end);
  assert.deepEqual(rows,[{pageUrl:url,date,clicks:3,impressions:30,ctr:.1,position:5}]);
  assert.deepEqual(parseGscPageResponse({responseAggregationType:"byPage"},url,start,end),[]);
});

test("reject cross-site, invalid dimensions and unsupported GSC aggregation",()=>{
  for(const altered of [
    {...good,responseAggregationType:"byProperty"},
    {rows:good.rows},
    {...good,rows:[{...good.rows[0],keys:[date,"https://other.test/products/other"]}]},
    {...good,rows:[{...good.rows[0],keys:[date]}]},
    {...good,rows:[{...good.rows[0],keys:["2026-11-11",url]}]},
    {...good,rows:[{...good.rows[0],ctr:.5}]},
    {...good,rows:[{...good.rows[0],clicks:2.5}]},
    {...good,rows:[{...good.rows[0],impressions:21.7}]},
    {...good,rows:[good.rows[0],good.rows[0]]},
    {...good,rows:null},
    {...good,metadata:{first_incomplete_date:date}},
  ]) assert.throws(()=>parseGscPageResponse(altered,url,start,end));
});

test("too many rows, malformed dates, and negative counts never become evidence",()=>{
  assert.throws(()=>parseGscPageResponse({
    responseAggregationType:"byPage",
    rows:Array.from({length:57},()=>good.rows[0])
  },url,start,end));
  assert.throws(()=>parseGscPageResponse({
    responseAggregationType:"byPage",
    rows:[{...good.rows[0],impressions:-1}]
  },url,start,end));
});

test("GSC request builder rejects arbitrary URLs and invalid or unbounded date windows",()=> {
  for (const badUrl of [
    "http://store.example.test/products/item",
    "https://store.example.test@evil.test/products/item",
    "https://store.example.test/products/item?variant=1",
    "https://store.example.test/collections/item",
    "https://store.example.test/products/item#fragment",
    "not-a-url",
  ]) assert.throws(()=>gscPageQuery(badUrl,start,end),/URL/);
  for (const [from,to] of [
    ["2026-11-02","2026-11-01"],
    ["2026-02-30","2026-03-01"],
    ["2026-09-01","2026-11-01"],
    ["2026-9-01","2026-10-01"],
  ]) assert.throws(()=>gscPageQuery(url,from,to),/date|window/i);
  assert.equal(gscPageQuery(url,"2026-10-01","2026-10-01").startDate,"2026-10-01");
});
