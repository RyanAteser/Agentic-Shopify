import db from "../db.server";

export const FREE_LIFETIME_GENERATIONS = 3;

/**
 * Reserve a lifetime Free-plan credit atomically before creating a job.
 * Paid entitlements are intentionally not enabled until Shopify App Pricing is linked.
 */
export async function createCreditedJob(shop: string, topic: string) {
  const claim = await db.storeConfig.updateMany({
    where: { shop, freeDraftsUsed: { lt: FREE_LIFETIME_GENERATIONS } },
    data: { freeDraftsUsed: { increment: 1 } },
  });
  if (!claim.count) {
    throw new Error("Free generation limit reached (3 lifetime drafts). Paid plans are not yet available.");
  }
  try {
    return await db.contentJob.create({ data: { shop, topic } });
  } catch (error) {
    // Revert only our reservation when inserting the job fails.
    await db.storeConfig.update({
      where: { shop },
      data: { freeDraftsUsed: { decrement: 1 } },
    });
    throw error;
  }
}

/** Refund a reservation exactly once when n8n dispatch definitively fails. */
export async function failCreditedJob(shop: string, id: string, error: unknown) {
  const result = await db.contentJob.updateMany({
    where: { id, shop, status: { in: ["queued", "running"] } },
    data: { status: "failed", error: String(error).slice(0, 400) },
  });
  if (result.count) {
    await db.storeConfig.update({
      where: { shop },
      data: { freeDraftsUsed: { decrement: 1 } },
    });
  }
  return result.count > 0;
}
