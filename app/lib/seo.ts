/**
 * Adapter contract for the existing Bright Data SERP-rank tracker.
 * Bright Data SERP placement is a point-in-time observation, NOT GSC
 * Search Analytics average position, search volume, or revenue.
 */
export type SeoRanking = {
  keyword: string; position: number | null; engine: "google" | "bing";
  country: string; device: "desktop" | "mobile";
  targetUrl: string; observedAt: Date; source: "brightdata-serp";
};
export function parseRanking(value: unknown, now = new Date()): SeoRanking {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ranking record must be an object");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.keyword !== "string") throw new Error("Keyword required");
  const keyword = row.keyword.toLowerCase().trim().replace(/\s+/g, " ");
  if (keyword.length < 2 || keyword.length > 120) throw new Error("Keyword length invalid");
  // No silent US/desktop/Google defaults: missing scrape context would create
  // misleading market-specific SEO trends.
  const engine = row.engine;
  if (engine !== "google" && engine !== "bing") throw new Error("Explicit search engine required");
  const device = row.device;
  if (device !== "desktop" && device !== "mobile") throw new Error("Explicit device required");
  const country = row.country;
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) throw new Error("Use ISO country code");
  // An omitted rank is an incomplete scrape or broken n8n mapping, NOT a
  // verified "not found" result. Require an explicit null from the connector.
  const position = row.position;
  if (position !== null && (!Number.isInteger(position) || (position as number) < 1 || (position as number) > 200)) {
    throw new Error("Organic position must be explicitly null or an integer 1-200");
  }
  // Require an explicit RFC3339 offset. Local-time strings silently depend on
  // the server timezone and can turn a scraped snapshot into a false trend.
  const timestamp = row.observedAt;
  if (typeof timestamp !== "string" ||
      !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(timestamp)) {
    throw new Error("Ranking requires RFC3339 timestamp with timezone");
  }
  const offset = timestamp.match(/[+-](\d{2}):(\d{2})$/);
  if (offset?.[1] === "14" && offset[2] !== "00") {
    throw new Error("Ranking timezone offset invalid");
  }
  const [year, month, day] = timestamp.slice(0, 10).split("-").map(Number);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (calendarDay.getUTCFullYear() !== year ||
      calendarDay.getUTCMonth() !== month - 1 ||
      calendarDay.getUTCDate() !== day) {
    throw new Error("Ranking calendar date invalid");
  }
  const observedAt = new Date(timestamp);
  if (Number.isNaN(observedAt.getTime()) || observedAt.getTime() > now.getTime() + 5 * 60000
      || observedAt.getTime() < now.getTime() - 365 * 86400000) {
    throw new Error("Ranking timestamp outside permitted window");
  }
  // A found result needs its actual URL; a verified not-found result must
  // explicitly carry an empty URL. Do not turn missing fields into evidence.
  const rawUrl = row.targetUrl;
  if (typeof rawUrl !== "string" || rawUrl.length > 500) throw new Error("Invalid target URL");
  if (position === null && rawUrl !== "") throw new Error("Not-found ranking requires an empty target URL");
  if (position !== null && !rawUrl) throw new Error("Found ranking requires a result URL");
  if (rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !url.hostname) throw new Error("Target URL must be HTTPS");
    if (url.username || url.password) throw new Error("URL credentials not allowed");
  }
  return { keyword, position: position as number | null, engine, device, country, targetUrl: rawUrl, observedAt, source: "brightdata-serp" };
}


/**
 * A single SERP snapshot cannot have two different results for the same
 * keyword, engine, country, device and timestamp. Reject ambiguous batches
 * rather than silently letting the last upsert win.
 */
export function assertUniqueRankingObservations(records: SeoRanking[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    const key = JSON.stringify([
      record.keyword, record.engine, record.country, record.device,
      record.observedAt.getTime()
    ]);
    if (seen.has(key)) throw new Error("Duplicate ranking snapshot in batch");
    seen.add(key);
  }
}

export type SeoProduct = {id:string;title:string;url:string|null;seo:{title:string|null;description:string|null}|null;description:string};
export type SeoFinding = {id:string;productId:string;productTitle:string;url:string;kind:string;message:string;severity:"high"|"medium";observedTitle?:string};
/** Shopify falls back to the product title when the custom SEO title is blank. */
export function effectiveSeoTitle(product: SeoProduct): string {
  return (product.seo?.title?.trim() || product.title.trim()).replace(/\s+/g, " ");
}
/** Shopify returns a null onlineStoreUrl for products not published to the
 * Online Store. Other-channel inventory is not a storefront SEO opportunity.
 * A URL does not prove Google indexing or market availability. */
export function isOnlineStoreSeoCandidate(product: SeoProduct): boolean {
  if (typeof product.url !== "string") return false;
  try {
    const url = new URL(product.url);
    return url.protocol === "https:" && !!url.hostname &&
      !url.username && !url.password;
  } catch { return false; }
}
export function auditProductSeo(products: SeoProduct[]): SeoFinding[] {
  const findings: SeoFinding[]=[];
  const titleGroups=new Map<string,SeoProduct[]>();
  for (const product of products) {
    if (!isOnlineStoreSeoCandidate(product)) continue;
    const title=effectiveSeoTitle(product);
    const description=(product.seo?.description || "").trim();
    const url=product.url || "";
    const add=(kind:string,message:string,severity:"high"|"medium") =>
      findings.push({id:product.id+":"+kind,productId:product.id,productTitle:product.title,url,kind,message,severity});
    // Shopify defaults product meta descriptions to product descriptions.
    // A blank custom SEO field is not proof of missing storefront metadata.
    if (!description && !product.description.trim()) {
      add("missing-description","Both the custom SEO description and product description are empty; inspect the rendered storefront metadata and add useful product information.","high");
    } else if (description.length > 320) {
      // Shopify warns about previews above 320 characters. Google has no fixed
      // snippet-length limit and may use on-page text instead of this field.
      add("long-description","Custom SEO description exceeds Shopify's 320-character preview guidance. Review clarity and storefront rendering; Google snippets vary by query and device.","medium");
    }
    // Google has no fixed title-length limit; truncation depends on device width.
    // Avoid inventing a ranking penalty or a 70-character cutoff.
    if (!title) add("missing-title","Missing meaningful product title.","high");
    else {
      const key=title.toLocaleLowerCase("en-US");
      titleGroups.set(key,[...(titleGroups.get(key)||[]),product]);
    }
  }
  // A duplicate is a property of every member of the observed group, not just
  // whichever product happened to appear second in Shopify's 50-item sample.
  for (const [normalizedTitle,group] of titleGroups) {
    if (group.length<2) continue;
    for (const product of group) {
      findings.push({
        id:product.id+":duplicate-title",productId:product.id,productTitle:product.title,
        url:product.url||"",kind:"duplicate-title",severity:"high",
        observedTitle:normalizedTitle,
        message:"Multiple sampled products use the same effective SEO title. Check whether their rendered, indexable pages need more distinct titles."
      });
    }
  }
  return findings;
}


/**
 * A ranking claim is merchant-specific only when its result URL belongs to
 * the currently authenticated Shopify primary storefront domain. Never
 * accept a competitor, arbitrary subdomain, or lookalike host as a store rank.
 * Non-primary Markets domains require separate, explicit domain attestation.
 */
export function assertRankingTargetsForPrimaryDomain(records: SeoRanking[], primaryHost: string): void {
  const host = primaryHost.trim().toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
      host.split(".").some(label => label.startsWith("-") || label.endsWith("-"))) {
    throw new Error("Verified Shopify primary domain unavailable");
  }
  for (const record of records) {
    if (record.position === null) {
      if (record.targetUrl) throw new Error("Not-found observation must have an empty target URL");
      continue;
    }
    if (!record.targetUrl) throw new Error("Found ranking requires a result URL");
    const url = new URL(record.targetUrl);
    // Revalidate here even for pre-parsed SeoRanking objects: callers may bypass
    // parseRanking. Nonstandard ports are not the verified storefront origin.
    if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password || url.port) {
      throw new Error("Ranking URL does not belong to the Shopify primary domain");
    }
  }
}
