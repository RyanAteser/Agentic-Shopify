import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProductContextUnavailableError, fetchVerifiedPublishedProducts,
  parseVerifiedPublishedProducts
} from "../app/lib/product-context.server";

const shop = "merchant-one.myshopify.com";
const product = {
  title: "Verified Travel Mug",
  description: "Stainless steel cup from the merchant catalog",
  onlineStoreUrl: "https://merchant.example/products/travel-mug"
};
const response = (nodes: unknown[], actualShop = shop, hasMore = false) => ({
  data: { shop: { myshopifyDomain: actualShop }, products: {
    nodes, pageInfo: { hasNextPage: hasMore }
  } }
});

test("Shopify product context attests tenant and preserves verified published products", async () => {
  let calls = 0;
  const result = await fetchVerifiedPublishedProducts(shop, {
    graphql: async query => {
      calls++;
      assert.match(query, /shop\s*\{\s*myshopifyDomain/);
      assert.match(query, /products\(first:\s*20/);
      assert.match(query, /published_status:published/);
      assert.match(query, /pageInfo\s*\{\s*hasNextPage/);
      return { ok: true, json: async () => response([product, {
        ...product, onlineStoreUrl: null
      }]) };
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { products: [{
    name: product.title, description: product.description, url: product.onlineStoreUrl
  }], hasMore: false });
  assert.deepEqual(parseVerifiedPublishedProducts(shop, response([])), { products: [], hasMore: false },
    "an authenticated empty catalog is valid, unlike a failed query");
});

test("GraphQL failures, malformed data and wrong tenant cannot masquerade as an empty catalog", () => {
  for (const raw of [
    null, {}, { data: { products: { nodes: [] } } },
    response([], "another.myshopify.com"),
    { ...response([]), errors: [{ message: "THROTTLED" }] },
    { ...response([]), errors: "not an array" },
    { data: { shop: { myshopifyDomain: shop }, products: {} } },
    response([null]), response([{ ...product, title: null }]),
    { data: { shop: { myshopifyDomain: shop }, products: { nodes: [product] } } },
    { data: { shop: { myshopifyDomain: shop }, products: {
      nodes: [product], pageInfo: { hasNextPage: "false" }
    } } },
    response([], shop, true),
    response(Array.from({ length: 21 }, () => product))
  ]) {
    assert.throws(() => parseVerifiedPublishedProducts(shop, raw),
      ProductContextUnavailableError);
  }
});

test("untrusted or malformed Shopify product URLs cannot enter an AI brief", () => {
  for (const badUrl of [
    "http://merchant.example/products/mug",
    "https://user:secret@merchant.example/products/mug",
    "https://merchant.example:8443/products/mug",
    "https://merchant.example/products/mug" + String.fromCharCode(10) + "/other",
    "javascript:alert(1)",
    "not a URL"
  ]) {
    assert.throws(() => parseVerifiedPublishedProducts(shop, response([
      { ...product, onlineStoreUrl: badUrl }
    ])), ProductContextUnavailableError);
  }
});

test("network, response parsing, HTTP and GraphQL errors abort product discovery", async () => {
  const failures = [
    { graphql: async () => { throw new Error("network error with merchant details"); } },
    { graphql: async () => ({ ok: false, json: async () => response([]) }) },
    { graphql: async () => ({ ok: true, json: async () => { throw new Error("bad JSON"); } }) },
    { graphql: async () => ({ ok: true, json: async () => ({
      ...response([]), errors: [{ extensions: { code: "THROTTLED" } }]
    }) }) }
  ];
  for (const admin of failures) {
    await assert.rejects(fetchVerifiedPublishedProducts(shop, admin),
      error => error instanceof ProductContextUnavailableError &&
        !error.message.includes("merchant details"));
  }
});

test("product URLs are never silently truncated before the AI brief", () => {
  const exact = "https://merchant.example/products/" + "x".repeat(
    350 - "https://merchant.example/products/".length
  );
  assert.equal(exact.length, 350);
  assert.deepEqual(parseVerifiedPublishedProducts(shop, response([
    { ...product, onlineStoreUrl: exact }
  ])).products[0].url, exact);
  assert.throws(() => parseVerifiedPublishedProducts(shop, response([
    { ...product, onlineStoreUrl: exact + "x" }
  ])), ProductContextUnavailableError);
});


test("Shopify pagination evidence distinguishes a full 20-product sample from a complete catalog", () => {
  const twenty = Array.from({ length: 20 }, (_, index) => ({
    ...product, title: `Product ${index}`,
    onlineStoreUrl: `https://merchant.example/products/${index}`
  }));
  const partial = parseVerifiedPublishedProducts(shop, response(twenty, shop, true));
  assert.equal(partial.products.length, 20);
  assert.equal(partial.hasMore, true, "The first 20 products are not the entire catalog");
  const complete = parseVerifiedPublishedProducts(shop, response(twenty, shop, false));
  assert.equal(complete.hasMore, false);
  const onlyNoUrl = parseVerifiedPublishedProducts(shop, response([
    { ...product, onlineStoreUrl: null }
  ], shop, false));
  assert.deepEqual(onlyNoUrl, { products: [], hasMore: false });
});
