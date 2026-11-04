import type { SeoProduct } from "./seo";
import { parseSearchConsoleRows, type OrganicMetric } from "./growth";

export const MAX_GSC_PRODUCT_PAGES = 12;
export const MAX_GSC_DATE_ROWS = 56;

/** Only an authenticated Shopify catalog may supply product URLs. */
export function selectGscProductUrls(
  products: SeoProduct[], primaryHost: string, limit = MAX_GSC_PRODUCT_PAGES
): string[] {
  if (!primaryHost || !primaryHost.includes(".") ||
      /(?:^localhost$|\.local$|\.internal$)/i.test(primaryHost) ||
      !/^[a-z0-9.-]+$/i.test(primaryHost) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_GSC_PRODUCT_PAGES) {
    throw new Error("Invalid verified Shopify primary host or GSC sample limit");
  }
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    if (product.url === null) continue;
    if (typeof product.url !== "string" || product.url.length > 500) {
      throw new Error("Untrusted Shopify product URL");
    }
    let url: URL;
    try { url = new URL(product.url); }
    catch { throw new Error("Invalid Shopify product URL"); }
    // Exclude redirects, alternate markets, locale prefixes and questionable
    // URL forms. Do not construct URLs from nullable Shopify onlineStoreUrl.
    if (url.protocol !== "https:" || url.hostname !== primaryHost ||
        url.username || url.password || url.port || url.search || url.hash ||
        !/^\/products\/[a-z0-9-]+\/?$/.test(url.pathname) ||
        url.href !== product.url) {
      continue;
    }
    if (seen.has(product.url)) throw new Error("Shopify catalog contains duplicate product URLs");
    seen.add(product.url);
    urls.push(product.url);
    if (urls.length >= limit) break;
  }
  return urls;
}

export function gscPageQuery(url: string, startDate: string, endDate: string) {
  // This function is also a boundary for future callers: never allow an
  // unbounded GSC request or an arbitrary URL supplied by a browser.
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error("Invalid GSC product URL"); }
  if (parsed.protocol !== "https:" || !parsed.hostname.includes(".") ||
      parsed.username || parsed.password || parsed.port || parsed.search ||
      parsed.hash || !/^\/products\/[a-z0-9-]+\/?$/.test(parsed.pathname) ||
      parsed.href !== url) {
    throw new Error("Invalid GSC product URL");
  }
  const parseDay = (value: string): number => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid GSC date");
    const day = Date.parse(value + "T00:00:00.000Z");
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value) {
      throw new Error("Invalid GSC date");
    }
    return day;
  };
  const from = parseDay(startDate), to = parseDay(endDate);
  if (to < from || (to - from) / 86400000 >= MAX_GSC_DATE_ROWS) {
    throw new Error("GSC page query exceeds bounded date window");
  }
  return {
    startDate, endDate,
    dimensions: ["date", "page"],
    type: "web",
    dataState: "final",
    aggregationType: "byPage",
    dimensionFilterGroups: [{
      groupType: "and",
      filters: [{ dimension: "page", operator: "equals", expression: url }],
    }],
    rowLimit: 100, startRow: 0,
  };
}

export type GscProductDay = OrganicMetric & { pageUrl: string };

/** Validate Google response without collapsing another page into this merchant. */
export function parseGscPageResponse(
  response: unknown, expectedUrl: string, startDate: string, endDate: string
): GscProductDay[] {
  // Validate response context independently of the request builder.
  // A future importer must not turn invalid context into evidence.
  gscPageQuery(expectedUrl, startDate, endDate);
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Invalid GSC page response");
  }
  const payload = response as Record<string, unknown>;
  if (payload.responseAggregationType !== "byPage") {
    throw new Error("Unexpected page report aggregation");
  }
  if (payload.metadata && typeof payload.metadata === "object" &&
      !Array.isArray(payload.metadata) &&
      ("first_incomplete_date" in payload.metadata || "first_incomplete_hour" in payload.metadata)) {
    throw new Error("GSC page response includes incomplete dates");
  }
  if (payload.error !== undefined ||
      (payload.metadata !== undefined &&
        (!payload.metadata || typeof payload.metadata !== "object" ||
          Array.isArray(payload.metadata))) ||
      (payload.rows !== undefined && !Array.isArray(payload.rows))) {
    throw new Error("Malformed GSC page rows");
  }
  const incoming = (payload.rows ?? []) as unknown[];
  if (incoming.length > MAX_GSC_DATE_ROWS) {
    throw new Error("GSC page-date response exceeds bounded date window");
  }
  const dates: unknown[] = [];
  for (const entry of incoming) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Malformed GSC page observation");
    }
    const row = entry as Record<string, unknown>;
    if (!Array.isArray(row.keys) || row.keys.length !== 2 ||
        row.keys[1] !== expectedUrl) {
      throw new Error("GSC response has an unexpected canonical page URL");
    }
    if (!Number.isSafeInteger(row.clicks) || !Number.isSafeInteger(row.impressions)) {
      throw new Error("GSC page clicks and impressions must be integer counts");
    }
    dates.push({...row,keys:[row.keys[0]]});
  }
  // Reuses strict date validation, de-duplication and CTR consistency checks.
  return parseSearchConsoleRows(dates,startDate,endDate).map(row=>({
    ...row,pageUrl:expectedUrl,
  }));
}
