/**
 * Shopify product context is evidence, not optional decoration. An API outage,
 * GraphQL error, or mismatched shop must not silently become an empty catalog
 * and trigger a paid, ungrounded AI article. A valid empty result is different:
 * merchants can still request general educational articles with no product links.
 */
export class ProductContextUnavailableError extends Error {
  constructor() {
    super("Shopify product context could not be verified. No AI generation was sent; try again after Shopify access recovers.");
    this.name = "ProductContextUnavailableError";
  }
}

export type VerifiedStoreProduct = {
  name: string;
  description: string;
  url: string;
};

/** A bounded sample, not a complete inventory. hasMore is attested by Shopify. */
export type VerifiedProductSample = {
  products: VerifiedStoreProduct[];
  hasMore: boolean;
};

export function parseVerifiedPublishedProducts(shop: string, raw: unknown): VerifiedProductSample {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProductContextUnavailableError();
  }
  const response = raw as Record<string, unknown>;
  if (response.errors !== undefined &&
      (!Array.isArray(response.errors) || response.errors.length > 0)) {
    throw new ProductContextUnavailableError();
  }
  const data = response.data as Record<string, unknown> | undefined;
  const actualShop = data?.shop as Record<string, unknown> | undefined;
  const products = data?.products as Record<string, unknown> | undefined;
  if (actualShop?.myshopifyDomain !== shop || !Array.isArray(products?.nodes) ||
      products.nodes.length > 20) {
    throw new ProductContextUnavailableError();
  }
  const pageInfo = products.pageInfo as Record<string, unknown> | undefined;
  // Without Shopify's pagination flag, twenty returned rows could be the
  // first twenty of thousands. Never tell the model the sample is complete.
  if (!pageInfo || typeof pageInfo !== "object" || Array.isArray(pageInfo) ||
      typeof pageInfo.hasNextPage !== "boolean" ||
      (pageInfo.hasNextPage && products.nodes.length === 0)) {
    throw new ProductContextUnavailableError();
  }

  const result: VerifiedStoreProduct[] = [];
  for (const node of products.nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new ProductContextUnavailableError();
    }
    const product = node as Record<string, unknown>;
    // Shopify returns null when a product has no online-store URL.
    if (product.onlineStoreUrl === null) continue;
    if (typeof product.title !== "string" || !product.title.trim() ||
        typeof product.description !== "string" ||
        typeof product.onlineStoreUrl !== "string" ||
        product.onlineStoreUrl.length > 350) {
      throw new ProductContextUnavailableError();
    }
    let url: URL;
    try {
      url = new URL(product.onlineStoreUrl);
    } catch {
      throw new ProductContextUnavailableError();
    }
    if (url.protocol !== "https:" || url.username || url.password ||
        url.port || !url.hostname.includes(".") ||
        /[\x00-\x1f\x7f]/.test(product.onlineStoreUrl)) {
      throw new ProductContextUnavailableError();
    }
    result.push({
      name: product.title.slice(0, 120),
      description: product.description.slice(0, 400),
      url: product.onlineStoreUrl,
    });
  }
  return { products: result, hasMore: pageInfo.hasNextPage };
}

type ReadOnlyAdmin = {
  graphql: (query: string) => Promise<{ json: () => Promise<unknown>; ok?: boolean }>;
};

export async function fetchVerifiedPublishedProducts(
  shop: string, admin: ReadOnlyAdmin
): Promise<VerifiedProductSample> {
  try {
    const response = await admin.graphql(`#graphql query AgenticProductContext {
      shop { myshopifyDomain }
      products(first: 20, query: "status:active published_status:published") {
        nodes { title description onlineStoreUrl }
        pageInfo { hasNextPage }
      }
    }`);
    if (response.ok === false) throw new ProductContextUnavailableError();
    return parseVerifiedPublishedProducts(shop, await response.json());
  } catch {
    // No raw upstream error bodies, tenant data, URLs, or tokens in logs.
    throw new ProductContextUnavailableError();
  }
}
