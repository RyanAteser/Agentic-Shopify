import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShopifyProductSample, summarizeShopifySeoSample } from "../app/lib/shopify-product-sample";

const published = {
  id: "gid://shopify/Product/1", title: "Leather boots",
  description: "Leather care details", onlineStoreUrl: "https://shop.example/products/boots",
  seo: { title: null, description: null }
};
const posOnly = {
  id: "gid://shopify/Product/2", title: "POS boots",
  description: "", onlineStoreUrl: null, seo: null
};
const response = (nodes: unknown[]) => ({data: {products: {nodes}}});

test("a verified empty Shopify catalog differs from a missing product connection", () => {
  assert.deepEqual(parseShopifyProductSample(response([])), []);
  for (const invalid of [
    null, {}, {data: null}, {data: {}}, {data: {products: null}},
    {data: {products: {}}}, {data: {products: {nodes: null}}},
    {data: {products: {nodes: "not an array"}}},
    {errors: [{message: "access denied"}], data: {products: {nodes: []}}},
  ]) {
    assert.throws(() => parseShopifyProductSample(invalid), /Shopify/);
  }
});

test("published and other-channel products retain their distinct URL evidence", () => {
  assert.deepEqual(parseShopifyProductSample(response([published, posOnly])), [
    {id: published.id, title: published.title, description: published.description,
      url: published.onlineStoreUrl, seo: {title: null, description: null}},
    {id: posOnly.id, title: posOnly.title, description: posOnly.description,
      url: null, seo: null},
  ]);
});

test("partial product records cannot masquerade as a successful empty SEO audit", () => {
  for (const invalidNode of [
    null, {}, {...published, id: ""}, {...published, title: undefined},
    {...published, description: undefined},
    {...published, onlineStoreUrl: undefined},
    {...published, seo: undefined},
    {...published, seo: {title: undefined, description: null}},
    {...published, seo: {title: null, description: 123}},
  ]) {
    assert.throws(() => parseShopifyProductSample(response([invalidNode])), /Shopify/);
  }
  assert.throws(() => parseShopifyProductSample(response([published, published])), /Shopify/);
  assert.throws(() => parseShopifyProductSample(response(Array(51).fill(posOnly))), /Shopify/);
});


test("password-protected Shopify product URL gaps do not imply unpublished inventory", () => {
  const coverage = summarizeShopifySeoSample(parseShopifyProductSample(response([
    published, posOnly,
    {...published, id: "gid://shopify/Product/3", onlineStoreUrl: "http://unsafe.example/boots"},
  ])));
  assert.equal(coverage.sampledProducts, 3);
  assert.deepEqual(coverage.eligibleProducts.map(p => p.id), [published.id]);
  assert.equal(coverage.missingUrls, 1);
  assert.equal(coverage.invalidUrls, 1);
  assert.match(coverage.warning, /Password-protected Shopify stores/);
  assert.match(coverage.warning, /null URL does not prove a product is unpublished/);
  assert.match(coverage.warning, /non-HTTPS/);
});

test("a verified empty product sample has no coverage warning; all-null URLs are not a clean audit", () => {
  const empty = summarizeShopifySeoSample(parseShopifyProductSample(response([])));
  assert.equal(empty.sampledProducts, 0);
  assert.equal(empty.warning, "");
  const inaccessible = summarizeShopifySeoSample(parseShopifyProductSample(response([posOnly])));
  assert.equal(inaccessible.sampledProducts, 1);
  assert.equal(inaccessible.eligibleProducts.length, 0);
  assert.equal(inaccessible.missingUrls, 1);
  assert.match(inaccessible.warning, /not audited/);
});
