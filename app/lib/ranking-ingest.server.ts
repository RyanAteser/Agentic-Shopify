import db from "../db.server";
import type { SeoRanking } from "./seo";

type ReadOnlyAdmin = { graphql: (query: string) => Promise<{ json: () => Promise<any> }> };

/**
 * Domain attestation comes from Shopify's authenticated Admin API, never from
 * the n8n payload. A shared connector key alone cannot attest a storefront.
 */
export async function primaryDomainForShop(admin: ReadOnlyAdmin, shop: string): Promise<string> {
  const response = await admin.graphql(`#graphql
query RankingStorefrontDomain {
    shop { myshopifyDomain primaryDomain { host } }
  }`);
  const result = await response.json();
  const actualShop = result?.data?.shop?.myshopifyDomain;
  const primaryHost = result?.data?.shop?.primaryDomain?.host;
  if (result?.errors?.length || actualShop !== shop ||
      typeof primaryHost !== "string" || !primaryHost) {
    throw new Error("Shopify storefront domain attestation unavailable");
  }
  return primaryHost;
}

/**
 * Serialize imports against uninstall/redaction using a conditional UPDATE
 * of the store row, which locks it for this transaction on PostgreSQL.
 * Every batch is atomic; no partial ranking history on database failure.
 */
/** A replay may repeat an observation but must never rewrite historical evidence. */
export class RankingSnapshotConflictError extends Error {
  constructor() {
    super("Ranking snapshot conflicts with an existing observation");
    this.name = "RankingSnapshotConflictError";
  }
}

export async function saveRankingsForShop(shop: string, entries: SeoRanking[], keyHash: string): Promise<void> {
  await db.$transaction(async tx => {
    const active = await tx.storeConfig.updateMany({
      where: { shop },
      data: { updatedAt: new Date() }
    });
    if (active.count !== 1) throw new Error("Store disconnected during ranking import");
    // Reauthorize under the same store row lock as rotation/uninstall.
    const credential = await tx.rankingConnectorCredential.findFirst({
      where: { shop, keyHash }, select: { shop: true }
    });
    if (!credential) throw new Error("Ranking connector revoked during import");
    for (const entry of entries) {
      const where = { shop_keyword_engine_country_device_observedAt: {
        shop, keyword: entry.keyword, engine: entry.engine,
        country: entry.country, device: entry.device, observedAt: entry.observedAt
      }};
      // The store row lock serializes all connector imports for this tenant.
      // A duplicate is idempotent only when the complete measurement agrees.
      const existing = await tx.seoRankObservation.findUnique({
        where, select: { position: true, targetUrl: true, source: true }
      });
      if (existing) {
        if (existing.position !== entry.position ||
            existing.targetUrl !== entry.targetUrl ||
            existing.source !== entry.source) {
          throw new RankingSnapshotConflictError();
        }
        continue;
      }
      await tx.seoRankObservation.create({ data: { shop, ...entry } });
    }
  });
}

/**
 * Durable per-merchant admission budget for the ranking connector. Charge a
 * valid request BEFORE the Shopify Admin API call, including requests that
 * subsequently fail storefront verification. This prevents repeated requests
 * with a compromised connector key from exhausting Shopify API capacity.
 *
 * Fixed UTC hour, at most 60 calls and 1,000 submitted rows per store. This
 * is not an IP/edge abuse limit or a Bright Data cost limit.
 */
export const RANKING_REQUESTS_PER_HOUR = 60;
export const RANKING_RECORDS_PER_HOUR = 1000;

export class RankingImportRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Ranking import quota exceeded");
    this.name = "RankingImportRateLimitError";
  }
}

export async function reserveRankingImportBudget(
  shop: string, keyHash: string, recordCount: number, now = new Date()
): Promise<void> {
  if (!Number.isInteger(recordCount) || recordCount < 1 || recordCount > 50 ||
      !Number.isFinite(now.getTime())) {
    throw new Error("Invalid ranking import budget request");
  }
  const hourMs = 3_600_000;
  const windowStart = new Date(Math.floor(now.getTime() / hourMs) * hourMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + hourMs - now.getTime()) / 1000));
  await db.$transaction(async tx => {
    // PostgreSQL row lock serializes concurrent admissions, rotation, and
    // uninstall; SQLite transactions serialize writers.
    const active = await tx.storeConfig.updateMany({
      where: { shop }, data: { updatedAt: now }
    });
    if (active.count !== 1) throw new Error("Store disconnected during ranking import");
    const credential = await tx.rankingConnectorCredential.findFirst({
      where: { shop, keyHash }, select: { shop: true }
    });
    if (!credential) throw new Error("Ranking connector revoked during import");
    const state = await tx.storeConfig.findUniqueOrThrow({
      where: { shop },
      select: { rankingWindowStart: true, rankingRequestsUsed: true, rankingRecordsUsed: true }
    });
    const current = state.rankingWindowStart?.getTime() === windowStart.getTime();
    const requests = current ? state.rankingRequestsUsed : 0;
    const records = current ? state.rankingRecordsUsed : 0;
    if (requests >= RANKING_REQUESTS_PER_HOUR ||
        records + recordCount > RANKING_RECORDS_PER_HOUR) {
      throw new RankingImportRateLimitError(retryAfterSeconds);
    }
    await tx.storeConfig.update({
      where: { shop },
      data: {
        rankingWindowStart: windowStart,
        rankingRequestsUsed: requests + 1,
        rankingRecordsUsed: records + recordCount
      }
    });
  });
}
