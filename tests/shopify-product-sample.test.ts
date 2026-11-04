import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShopifyProductSample, summarizeShopifySeoSample, readShopifySeoCatalog } from "../app/lib/shopify-product-sample";

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
    {...published, id: "gid://shopify/Collection/1"},
    {...published, id: "gid://shopify/ProductVariant/1"},
    {...published, id: "gid://shopify/Product/0"},
    {...published, id: "gid://shopify/Product/not-an-id"},
    {...published, id: "gid://shopify/Product/1?other=2"},
  ]) {
    assert.throws(() => parseShopifyProductSample(response([invalidNode])), /Shopify/);
  }
  assert.throws(() => parseShopifyProductSample(response([published, published])), /Shopify/);
  assert.throws(() => parseShopifyProductSample(response(Array(51).fill(posOnly))), /Shopify/);
});


test("only Shopify Product GIDs are accepted as product observations", () => {
  const valid = parseShopifyProductSample(response([
    {...published, id: "gid://shopify/Product/1234567890123456789"},
  ]));
  assert.equal(valid[0].id, "gid://shopify/Product/1234567890123456789");
  // A typed Shopify ID prevents accidental collection/variant joins from
  // being presented as product-level SEO evidence.
  for (const id of [
    "gid://shopify/Collection/123", "gid://shopify/ProductVariant/123",
    "gid://shopify/Product/12/extra", "gid://shopify/Product/12?foo=bar",
    "gid://other/Product/12", "gid://shopify/Product/-1",
  ]) {
    assert.throws(() => parseShopifyProductSample(response([{...published, id}])), /Shopify/);
  }
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

const page = (nodes: unknown[], hasNextPage: boolean, endCursor: string | null) => ({
  data: {products: {nodes, pageInfo: {hasNextPage, endCursor}}}
});
const item = (id: number) => ({
  ...published, id: "gid://shopify/Product/" + id,
  onlineStoreUrl: "https://shop.example/products/item-" + id
});

test("bounded pagination evaluates 100 products and reports additional unsampled inventory", async () => {
  const calls: Array<string | null> = [];
  const admin = {graphql: async (query: string, options: {variables: {after: string | null}}) => {
    assert.match(query, /published_status:published/);
    const cursor = options.variables.after;
    calls.push(cursor);
    return {json: async () => cursor === null
      ? page(Array.from({length: 50}, (_, i) => item(i + 1)), true, "cursor-50")
      : page(Array.from({length: 50}, (_, i) => item(i + 51)), true, "cursor-100")};
  }};
  const result = await readShopifySeoCatalog(admin);
  assert.deepEqual(calls, [null, "cursor-50"], "never make an unbounded third request");
  assert.equal(result.products.length, 100);
  assert.equal(new Set(result.products.map(p => p.id)).size, 100);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.hasMore, true);
  const summary = summarizeShopifySeoSample(result.products, result.hasMore);
  assert.equal(summary.eligibleProducts.length, 100);
  assert.match(summary.warning, /Additional published products exist beyond the 100 sampled/);
});

test("single complete Shopify page needs no second request or truncation warning", async () => {
  let calls = 0;
  const result = await readShopifySeoCatalog({graphql: async () => {
    calls++;
    return {json: async () => page([item(1)], false, "cursor-1")};
  }});
  assert.equal(calls, 1);
  assert.equal(result.pagesFetched, 1);
  assert.equal(result.hasMore, false);
  assert.equal(summarizeShopifySeoSample(result.products, result.hasMore).warning, "");
});

test("malformed second pages, cross-page duplicates and cursor loops fail closed", async () => {
  const first = page([item(1)], true, "cursor-1");
  for (const second of [
    {data: {products: {nodes: null}}},
    page([item(1)], false, "cursor-2"),
    page([item(2)], true, "cursor-1"),
    page([], true, "cursor-2"),
    {data: {products: {nodes: [item(2)], pageInfo: {hasNextPage: true}}}},
  ]) {
    let calls = 0;
    await assert.rejects(readShopifySeoCatalog({graphql: async () => ({
      json: async () => ++calls === 1 ? first : second
    })}), /Shopify/);
    assert.equal(calls, 2);
  }
});

test("empty continuation page cannot silently certify complete catalog coverage", async () => {
  const first = page([item(1)], true, "cursor-1");
  for (const second of [
    page([], false, null),
    page([], false, "cursor-2"),
    page([], true, "cursor-2"),
  ]) {
    let calls = 0;
    await assert.rejects(readShopifySeoCatalog({graphql: async () => ({
      json: async () => ++calls === 1 ? first : second
    })}), /empty continuation page/);
    assert.equal(calls, 2);
  }
  // A genuinely empty first page is valid only when Shopify says it is final.
  const empty = await readShopifySeoCatalog({graphql: async () => ({
    json: async () => page([], false, null)
  })});
  assert.deepEqual(empty, {products: [], hasMore: false, pagesFetched: 1});
});

test("missing pagination metadata is not accepted as a complete catalog", async () => {
  await assert.rejects(readShopifySeoCatalog({graphql: async () => ({
    json: async () => response([item(1)])
  })}), /pagination information/);
});
