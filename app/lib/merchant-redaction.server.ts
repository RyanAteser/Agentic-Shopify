import db from "../db.server";

/**
 * Remove all app-owned records for a verified Shopify merchant.
 *
 * Delete Session rows FIRST, then StoreConfig, in the same transaction.
 * Authenticated page loads and preference saves lock the persisted Session
 * before creating StoreConfig; deleting Session first prevents a stale request
 * from recreating configuration after uninstall. Background callbacks and
 * ranking imports lock StoreConfig before writing; deleting it next prevents
 * their late writes. Neither path can recreate merchant data after commit.
 *
 * This helper is shared by app/uninstalled and shop/redact so that adding a
 * new merchant-owned table cannot silently leave one privacy path behind.
 * Call only after authenticate.webhook() has verified the Shopify signature.
 */
export async function eraseMerchantData(shop: string): Promise<void> {
  await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.storeConfig.deleteMany({ where: { shop } }),
    db.rankingConnectorCredential.deleteMany({ where: { shop } }),
    db.googleAuthState.deleteMany({ where: { shop } }),
    db.searchConsoleConnection.deleteMany({ where: { shop } }),
    db.organicDailyMetric.deleteMany({ where: { shop } }),
    db.gscProductDailyMetric.deleteMany({ where: { shop } }),
    db.storeActivity.deleteMany({ where: { shop } }),
    db.storeRecommendation.deleteMany({ where: { shop } }),
    db.editorialReview.deleteMany({ where: { shop } }),
    db.articleDraft.deleteMany({ where: { shop } }),
    db.seoRankObservation.deleteMany({ where: { shop } }),
    db.contentJob.deleteMany({ where: { shop } }),
  ]);
}
