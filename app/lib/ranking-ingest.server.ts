import db from "../db.server";
import type { SeoRanking } from "./seo";

type ReadOnlyAdmin = { graphql: (query: string) => Promise<{ json: () => Promise<any> }> };

/**
 * Domain attestation comes from Shopify's authenticated Admin API, never from
 * the n8n payload. A shared connector key alone cannot attest a storefront.
 */
export async function primaryDomainForShop(admin: ReadOnlyAdmin, shop: string): Promise<string> {
  const response = await admin.graphql(`#graphql query RankingStorefrontDomain {
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
      await tx.seoRankObservation.upsert({
        where: { shop_keyword_engine_country_device_observedAt: {
          shop, keyword: entry.keyword, engine: entry.engine,
          country: entry.country, device: entry.device, observedAt: entry.observedAt
        }},
        create: { shop, ...entry },
        update: { position: entry.position, targetUrl: entry.targetUrl, source: entry.source }
      });
    }
  });
}
