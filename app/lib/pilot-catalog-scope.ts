import type { SeoProduct } from "./seo";

/**
 * Pilot observations must belong to the authenticated merchant's Shopify-
 * attested primary storefront. A valid HTTPS URL is not sufficient: Shopify
 * can return market/redirect URLs hosted on another domain.
 */
export function scopePilotCatalog(products: SeoProduct[], primaryHost: string) {
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(primaryHost) ||
      primaryHost.includes("..") || primaryHost.length > 253) {
    throw new Error("Shopify primary domain is not usable");
  }
  const host = primaryHost.toLowerCase();
  const eligible: SeoProduct[] = [];
  let excludedForeign = 0;
  for (const product of products) {
    if (!product.url) continue;
    let url: URL;
    try { url = new URL(product.url); }
    catch { continue; } // Existing sample audit counts malformed URLs.
    if (url.hostname.toLowerCase() !== host) {
      excludedForeign++;
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password ||
        url.port || url.search || url.hash ||
        url.href !== product.url) continue;
    eligible.push(product);
  }
  return {eligible, excludedForeign};
}
