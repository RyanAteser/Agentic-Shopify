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

/**
 * An empty audited sample is not a clean SEO audit. A partial sample also
 * cannot support a whole-catalog clean bill of health.
 */
export function catalogAuditConclusion(input: {
  sampled: number; eligible: number; findings: number; hasMore: boolean;
}): string {
  const {sampled,eligible,findings,hasMore}=input;
  if (![sampled,eligible,findings].every(n=>Number.isSafeInteger(n)&&n>=0) ||
      eligible>sampled || typeof hasMore!=="boolean") {
    throw new Error("Invalid catalog audit coverage");
  }
  if (eligible===0) {
    return sampled===0
      ? "No products were returned in the bounded Shopify sample. No SEO audit was performed."
      : "No sampled product had a verified, eligible primary-storefront URL. No SEO audit was performed.";
  }
  if (findings>0) {
    return `${findings} potential SEO issue(s) observed among ${eligible} eligible sampled products. Findings require merchant review.`;
  }
  return hasMore || eligible<sampled
    ? "No issues detected among eligible sampled products. Excluded or unsampled pages were not audited."
    : "No issues detected among eligible sampled products. This is not proof of Google indexing, full-store SEO quality or growth.";
}
