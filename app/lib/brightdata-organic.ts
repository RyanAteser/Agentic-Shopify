import { parseRanking, type SeoRanking } from "./seo";

/** The context must come from the actual SERP request, not merchant defaults. */
export type BrightDataOrganicContext = {
  keyword: string;
  country: string;
  device: "desktop" | "mobile";
  observedAt: string;
  primaryHost: string;
  /** Actual Google URL submitted to Bright Data, never reconstructed from defaults. */
  requestUrl: string;
};


/**
 * The parsed Bright Data response may omit general.gl. Check the original
 * submitted search URL instead of silently attributing its rankings to a
 * country, language, device, or search vertical the merchant did not query.
 *
 * This is consistency validation, not cryptographic proof of scrape origin.
 * Until the ranking schema includes locale, only first-page English-language
 * standard Google web searches are comparable.
 */
function assertRequestedGoogleSerp(context: BrightDataOrganicContext): void {
  if (typeof context.requestUrl !== "string" || context.requestUrl.length > 2048) {
    throw new Error("Bright Data request URL evidence required");
  }
  let request: URL;
  try { request = new URL(context.requestUrl); }
  catch { throw new Error("Invalid Bright Data request URL"); }
  if (request.protocol !== "https:" || request.hostname !== "www.google.com" ||
      request.port || request.username || request.password || request.hash ||
      request.pathname !== "/search") {
    throw new Error("Bright Data request must target standard Google web search");
  }
  const allowed = new Set(["q", "gl", "hl", "brd_json", "start", "brd_mobile", "pws"]);
  for (const key of request.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error("Unsupported Bright Data search dimension: " + key);
  }
  const exactlyOne = (key: string): string => {
    const values = request.searchParams.getAll(key);
    if (values.length !== 1) throw new Error("Bright Data request requires exactly one " + key);
    return values[0];
  };
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalize(exactlyOne("q")) !== normalize(context.keyword)) {
    throw new Error("Bright Data requested query mismatch");
  }
  if (!/^[A-Z]{2}$/.test(context.country) ||
      exactlyOne("gl").toUpperCase() !== context.country) {
    throw new Error("Bright Data requested country mismatch");
  }
  if (exactlyOne("hl").toLowerCase() !== "en") {
    throw new Error("Unsupported Bright Data search language");
  }
  if (exactlyOne("brd_json") !== "1") {
    throw new Error("Bright Data parsed JSON mode required");
  }
  if (request.searchParams.has("start") && exactlyOne("start") !== "0") {
    throw new Error("Bright Data request must be the first results page");
  }
  if (exactlyOne("pws") !== "0") {
    throw new Error("Bright Data personalization must be disabled");
  }
  const mobile = request.searchParams.getAll("brd_mobile");
  if ((context.device === "desktop" && mobile.length !== 0) ||
      (context.device === "mobile" && (mobile.length !== 1 || mobile[0] !== "1")) ||
      (context.device !== "desktop" && context.device !== "mobile")) {
    throw new Error("Bright Data requested device mismatch");
  }
}

/**
 * Adapt a Bright Data parsed Google SERP (brd_json=1) to the application's
 * one-organic-landing-page-per-keyword contract. This deliberately never
 * manufactures a position:null observation: a truncated SERP, omitted page,
 * or failed scrape cannot establish absence from search.
 *
 * Caller must separately attest primaryHost against Shopify Admin and
 * retain the actual requested locale, device and capture timestamp.
 */
export function normalizeBrightDataOrganicGoogle(
  payload: unknown, context: BrightDataOrganicContext, now = new Date()
): SeoRanking[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Bright Data response must be an object");
  }
  assertRequestedGoogleSerp(context);
  const data = payload as Record<string, unknown>;
  const general = data.general;
  if (!general || typeof general !== "object" || Array.isArray(general)) {
    throw new Error("Bright Data search context is missing");
  }
  const meta = general as Record<string, unknown>;
  if (meta.search_engine !== "google" || meta.device !== context.device ||
      typeof meta.query !== "string" ||
      meta.query.trim().toLowerCase().replace(/\s+/g, " ") !== context.keyword.trim().toLowerCase().replace(/\s+/g, " ")) {
    throw new Error("Bright Data search context does not match the requested query and device");
  }
  if (meta.gl !== undefined &&
      (typeof meta.gl !== "string" || meta.gl.toUpperCase() !== context.country)) {
    throw new Error("Bright Data country does not match the requested market");
  }
  const host = context.primaryHost.trim().toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
      host.split(".").some(label => label.startsWith("-") || label.endsWith("-"))) {
    throw new Error("Verified primary storefront host required");
  }
  if (!Array.isArray(data.organic)) {
    throw new Error("Bright Data organic result list is missing");
  }
  const seenRanks = new Set<number>();
  let best: {rank: number; url: string} | undefined;
  for (const entry of data.organic) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Malformed Bright Data organic result");
    }
    const row = entry as Record<string, unknown>;
    // global_rank counts SERP features and must not replace organic rank.
    if (!Number.isInteger(row.rank) || (row.rank as number) < 1 || (row.rank as number) > 200 ||
        typeof row.link !== "string") {
      throw new Error("Bright Data organic rank or link is missing or invalid");
    }
    const rank = row.rank as number;
    if (seenRanks.has(rank)) throw new Error("Duplicate Bright Data organic rank");
    seenRanks.add(rank);
    let url: URL;
    try { url = new URL(row.link); }
    catch { throw new Error("Invalid Bright Data organic link"); }
    if (!(["http:", "https:"].includes(url.protocol)) || !url.hostname || url.username || url.password) {
      throw new Error("Invalid Bright Data organic link");
    }
    if (url.protocol === "https:" && url.hostname === host && !url.port && (!best || rank < best.rank)) {
      best = {rank, url: row.link};
    }
  }
  if (!best) return [];
  return [parseRanking({
    keyword: context.keyword, engine: "google", country: context.country,
    device: context.device, observedAt: context.observedAt,
    position: best.rank, targetUrl: best.url
  }, now)];
}
