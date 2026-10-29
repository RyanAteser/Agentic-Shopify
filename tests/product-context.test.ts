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
const response = (nodes: unknown[], actualShop = shop) => ({
  data: { shop: { myshopifyDomain: actualShop }, products: { nodes } }
});

test("Shopify product context attests tenant and preserves verified published products", async () => {
  let calls = 0;
  const result = await fetchVerifiedPublishedProducts(shop, {
    graphql: async query => {
      calls++;
      assert.match(query, /shop\s*\{\s*myshopifyDomain/);
      assert.match(query, /products\(first:\s*20/);
      assert.match(query, /published_status:published/);
      return { ok: true, json: async () => response([product, {
        ...product, onlineStoreUrl: null
      }]) };
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, [{
    name: product.title, description: product.description, url: product.onlineStoreUrl
  }]);
  assert.deepEqual(parseVerifiedPublishedProducts(shop, response([])), [],
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
  ]))[0].url, exact);
  assert.throws(() => parseVerifiedPublishedProducts(shop, response([
    { ...product, onlineStoreUrl: exact + "x" }
  ])), ProductContextUnavailableError);
});
