import { isOnlineStoreSeoCandidate, type SeoProduct } from "./seo";

/**
 * Treat missing or malformed Shopify GraphQL catalog data as an unavailable
 * sample, not as a verified empty catalog. The caller owns the warning UI.
 * Null Online Store URLs are legitimate and filtered by the SEO candidate gate.
 */
export function parseShopifyProductSample(payload: unknown): SeoProduct[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Shopify catalog response is malformed");
  }
  const response = payload as Record<string, unknown>;
  if (response.errors !== undefined &&
      (!Array.isArray(response.errors) || response.errors.length > 0)) {
    throw new Error("Shopify product API returned errors");
  }
  const data = response.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Shopify catalog data is unavailable");
  }
  const products = (data as Record<string, unknown>).products;
  if (!products || typeof products !== "object" || Array.isArray(products)) {
    throw new Error("Shopify product connection is unavailable");
  }
  const nodes = (products as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes) || nodes.length > 50) {
    throw new Error("Shopify product sample is malformed");
  }
  const ids = new Set<string>();
  return nodes.map((node: unknown): SeoProduct => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error("Shopify product record is malformed");
    }
    const p = node as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id || ids.has(p.id) ||
        typeof p.title !== "string" || typeof p.description !== "string" ||
        (p.onlineStoreUrl !== null && typeof p.onlineStoreUrl !== "string") ||
        (p.seo !== null && (!p.seo || typeof p.seo !== "object" || Array.isArray(p.seo)))) {
      throw new Error("Shopify product fields are incomplete");
    }
    ids.add(p.id);
    const seo = p.seo as Record<string, unknown> | null;
    if (seo && ((seo.title !== null && typeof seo.title !== "string") ||
                (seo.description !== null && typeof seo.description !== "string"))) {
      throw new Error("Shopify product SEO fields are incomplete");
    }
    return {
      id: p.id, title: p.title, description: p.description,
      url: p.onlineStoreUrl as string | null,
      seo: seo ? {title: seo.title as string | null, description: seo.description as string | null} : null,
    };
  });
}

/**
 * URL coverage is not publication coverage. Shopify may return a null
 * onlineStoreUrl for published products on password-protected storefronts,
 * including development stores. Never synthesize a public URL or mark these
 * products as unpublished, audited, or remediated.
 */
export function summarizeShopifySeoSample(products: SeoProduct[], hasMore = false) {
  const eligibleProducts = products.filter(isOnlineStoreSeoCandidate);
  const missingUrls = products.filter(product => product.url === null).length;
  const invalidUrls = products.length - eligibleProducts.length - missingUrls;
  const warnings: string[] = [];
  if (missingUrls) {
    warnings.push(`${missingUrls} sampled Online Store-published product(s) had no storefront URL. Password-protected Shopify stores can suppress these URLs even when products are published. These pages were not audited; a null URL does not prove a product is unpublished.`);
  }
  if (invalidUrls) {
    warnings.push(`${invalidUrls} sampled product(s) had invalid or non-HTTPS storefront URLs and were not audited.`);
  }
  if (hasMore) {
    warnings.push(`Additional published products exist beyond the ${products.length} sampled. This is not a complete catalog audit; duplicate titles and other findings may be missed.`);
  }
  return {
    eligibleProducts,
    sampledProducts: products.length,
    missingUrls,
    invalidUrls,
    warning: warnings.join(" "),
  };
}

/**
 * Read at most two 50-product Shopify pages per audit. Fail the entire read if
 * either response is malformed: a partial catalog must never masquerade as a
 * clean or complete sample. pageInfo is mandatory for honest coverage.
 * No product data is written to Shopify.
 */
export async function readShopifySeoCatalog(admin: {graphql: Function}): Promise<{
  products: SeoProduct[]; hasMore: boolean; pagesFetched: number;
}> {
  const query = `#graphql
query ShopifySeoCatalog($after: String) {
    products(first: 50, after: $after, query: "status:active published_status:published") {
      nodes { id title description onlineStoreUrl seo { title description } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const products: SeoProduct[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let after: string | null = null;
  let hasMore = false;
  let pagesFetched = 0;
  for (let page = 0; page < 2; page++) {
    const response = await admin.graphql(query, {variables: {after}});
    const payload: unknown = await response.json();
    const batch = parseShopifyProductSample(payload);
    // A prior page promised more products. An empty follow-up page cannot
    // substantiate completion of that catalog scan; abstain rather than
    // reporting the earlier subset as the whole eligible catalog.
    if (page > 0 && batch.length === 0) {
      throw new Error("Shopify product pagination returned an empty continuation page");
    }
    const connection = (payload as {data: {products: Record<string, unknown>}}).data.products;
    const info = connection.pageInfo;
    if (!info || typeof info !== "object" || Array.isArray(info)) {
      throw new Error("Shopify product pagination information is unavailable");
    }
    const pageInfo = info as Record<string, unknown>;
    if (typeof pageInfo.hasNextPage !== "boolean" ||
        (pageInfo.endCursor !== null && typeof pageInfo.endCursor !== "string")) {
      throw new Error("Shopify product pagination information is malformed");
    }
    if (pageInfo.hasNextPage &&
        (typeof pageInfo.endCursor !== "string" || !pageInfo.endCursor ||
         !batch.length || cursors.has(pageInfo.endCursor))) {
      throw new Error("Shopify product pagination cursor is invalid");
    }
    for (const product of batch) {
      if (ids.has(product.id)) throw new Error("Shopify product appears on multiple catalog pages");
      ids.add(product.id);
      products.push(product);
    }
    pagesFetched++;
    hasMore = pageInfo.hasNextPage;
    if (!hasMore) break;
    after = pageInfo.endCursor as string;
    cursors.add(after);
  }
  return {products, hasMore, pagesFetched};
}
