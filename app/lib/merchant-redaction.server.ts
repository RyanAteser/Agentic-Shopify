import db from "../db.server";

/**
 * Remove all app-owned records for a verified Shopify merchant.
 *
 * The StoreConfig deletion MUST be the first statement in the transaction.
 * Article callbacks and ranking imports lock that same row before writing,
 * so no late integration request can recreate data after redaction commits.
 *
 * This helper is shared by app/uninstalled and shop/redact so that adding a
 * new merchant-owned table cannot silently leave one privacy path behind.
 * Call only after authenticate.webhook() has verified the Shopify signature.
 */
export async function eraseMerchantData(shop: string): Promise<void> {
  await db.$transaction([
    db.storeConfig.deleteMany({ where: { shop } }),
    db.rankingConnectorCredential.deleteMany({ where: { shop } }),
    db.googleAuthState.deleteMany({ where: { shop } }),
    db.searchConsoleConnection.deleteMany({ where: { shop } }),
    db.organicDailyMetric.deleteMany({ where: { shop } }),
    db.storeActivity.deleteMany({ where: { shop } }),
    db.storeRecommendation.deleteMany({ where: { shop } }),
    db.editorialReview.deleteMany({ where: { shop } }),
    db.articleDraft.deleteMany({ where: { shop } }),
    db.seoRankObservation.deleteMany({ where: { shop } }),
    db.contentJob.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}
