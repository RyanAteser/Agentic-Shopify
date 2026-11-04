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
  const seenUrls = new Set<string>();
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
    // A primary-domain URL is not necessarily a product page. A Shopify
    // redirect to the home page, a collection, or an article must never be
    // presented as a product-specific SEO observation. Allow an optional
    // locale prefix used by localized Shopify storefront routes.
    const segments = url.pathname.split("/").filter(Boolean);
    const productIndex = segments[0] === "products" ? 0 :
      (/^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0] ?? "") &&
       segments[1] === "products" ? 1 : -1);
    if (productIndex < 0 || segments.length !== productIndex + 2 ||
        !/^[a-z0-9][a-z0-9-]*$/i.test(segments[productIndex + 1])) continue;
    // Duplicate canonical URLs make the sample's page coverage and findings
    // ambiguous. Abstain rather than count one page as multiple products.
    if (seenUrls.has(url.href)) {
      throw new Error("Duplicate Shopify primary-storefront product URL");
    }
    seenUrls.add(url.href);
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

/**
 * The first 25 observations must not depend on Shopify's pagination order:
 * otherwise low-severity issues can crowd out higher-priority issues. Sort
 * only existing observations; never invent a severity or an impact estimate.
 * A stable product/id tie-break makes repeated reads reproducible.
 */
export function prioritizeCatalogFindings<T extends {
  severity: "high" | "medium"; id: string;
}>(findings: readonly T[]): T[] {
  return [...findings].sort((a, b) =>
    (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A bounded UI must disclose omitted findings rather than imply full review. */
export function catalogFindingDisplay(total: number, limit = 25) {
  if (!Number.isSafeInteger(total) || total < 0 ||
      !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Invalid catalog finding display bounds");
  }
  const displayed = Math.min(total, limit);
  return {displayed, omitted: total - displayed,
    notice: total > limit
      ? `Showing ${displayed} of ${total} potential SEO findings; ${total - displayed} additional finding(s) are not displayed. This is a bounded review, not a complete issue list.`
      : ""};
}
