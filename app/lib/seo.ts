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
  const engine = row.engine === undefined ? "google" : row.engine;
  if (engine !== "google" && engine !== "bing") throw new Error("Unsupported search engine");
  const device = row.device === undefined ? "desktop" : row.device;
  if (device !== "desktop" && device !== "mobile") throw new Error("Unsupported device");
  const country = row.country === undefined ? "US" : row.country;
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) throw new Error("Use ISO country code");
  const position = row.position === null || row.position === undefined ? null : row.position;
  if (position !== null && (!Number.isInteger(position) || (position as number) < 1 || (position as number) > 200)) {
    throw new Error("Organic position must be an integer 1-200 or null");
  }
  if (typeof row.observedAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(row.observedAt)) {
    throw new Error("Ranking requires observedAt ISO timestamp");
  }
  const observedAt = new Date(row.observedAt);
  if (Number.isNaN(observedAt.getTime()) || observedAt.getTime() > now.getTime() + 5 * 60000
      || observedAt.getTime() < now.getTime() - 365 * 86400000) {
    throw new Error("Ranking timestamp outside permitted window");
  }
  const rawUrl = row.targetUrl === undefined ? "" : row.targetUrl;
  if (typeof rawUrl !== "string" || rawUrl.length > 500) throw new Error("Invalid target URL");
  if (rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !url.hostname) throw new Error("Target URL must be HTTPS");
    if (url.username || url.password) throw new Error("URL credentials not allowed");
  }
  return { keyword, position: position as number | null, engine, device, country, targetUrl: rawUrl, observedAt, source: "brightdata-serp" };
}

export type SeoProduct = {id:string;title:string;url:string|null;seo:{title:string|null;description:string|null}|null;description:string};
export type SeoFinding = {id:string;productId:string;productTitle:string;url:string;kind:string;message:string;severity:"high"|"medium"};
export function auditProductSeo(products: SeoProduct[]): SeoFinding[] {
  const findings: SeoFinding[]=[];
  const titleMap=new Map<string,string>();
  for (const product of products) {
    const title=(product.seo?.title || product.title || "").trim();
    const description=(product.seo?.description || "").trim();
    const url=product.url || "";
    const add=(kind:string,message:string,severity:"high"|"medium") =>
      findings.push({id:product.id+":"+kind,productId:product.id,productTitle:product.title,url,kind,message,severity});
    if (!description) add("missing-description","SEO description is empty; review whether a custom description would be helpful.","high");
    else if (description.length > 165) add("long-description","SEO description is longer than 165 characters; inspect possible SERP truncation.","medium");
    if (title.length > 70) add("long-title","Title exceeds 70 characters; inspect readability and possible SERP truncation.","medium");
    if (!title) add("missing-title","Missing meaningful product title.","high");
    else {
      const other=titleMap.get(title.toLowerCase());
      if (other && other !== product.id) add("duplicate-title","Another sampled product uses an identical SEO title.","high");
      else titleMap.set(title.toLowerCase(),product.id);
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
    if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password) {
      throw new Error("Ranking URL does not belong to the Shopify primary domain");
    }
  }
}
