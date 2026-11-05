import type { Prisma } from "@prisma/client";
import db from "../db.server";

export type MerchantPreferences = {
  blogId: string;
  authorName: string;
  audience: string;
  brandVoice: string;
  seedTopics: string;
  cadenceDays: number;
  enabled: boolean;
};

/**
 * Session-first lock ordering is shared with merchant redaction.
 *
 * An already-authenticated request may resume after app/uninstalled has
 * deleted its session. Merely trusting authenticate.admin() and upserting a
 * StoreConfig can then resurrect merchant data. Lock the persisted Session
 * row inside the same transaction as configuration creation/update.
 *
 * updateMany with an unchanged primary key is intentional: it takes a write
 * lock on PostgreSQL and works with the SQLite development schema.
 */
async function lockMerchantSession(
  tx: Prisma.TransactionClient,
  shop: string,
  sessionId: string,
) {
  const active = await tx.session.updateMany({
    where: { id: sessionId, shop },
    data: { id: sessionId },
  });
  return active.count === 1;
}

export async function loadMerchantConfig(shop: string, sessionId: string) {
  return db.$transaction(async tx => {
    if (!(await lockMerchantSession(tx, shop, sessionId))) return null;
    return tx.storeConfig.upsert({
      where: { shop }, create: { shop }, update: {},
    });
  });
}

export async function saveMerchantConfig(
  shop: string,
  sessionId: string,
  preferences: MerchantPreferences,
) {
  return db.$transaction(async tx => {
    if (!(await lockMerchantSession(tx, shop, sessionId))) return false;
    const previous = await tx.storeConfig.findUnique({ where: { shop } });
    const nextRunAt = !preferences.enabled
      ? null
      : previous?.enabled ? previous.nextRunAt ?? new Date() : new Date();
    // A scheduled draft reserved before a merchant changes the automation
    // must not be dispatched later with an obsolete topic, blog or brief.
    // The upsert locks StoreConfig first; claimQueuedDispatch uses the same
    // store -> job lock order. Only still-queued scheduled jobs are canceled.
    const scheduledInputsChanged = previous !== null && (
      previous.enabled !== preferences.enabled ||
      previous.blogId !== preferences.blogId ||
      previous.authorName !== preferences.authorName ||
      previous.audience !== preferences.audience ||
      previous.brandVoice !== preferences.brandVoice ||
      previous.seedTopics !== preferences.seedTopics ||
      previous.cadenceDays !== preferences.cadenceDays
    );
    await tx.storeConfig.upsert({
      where: { shop },
      create: { shop, ...preferences, nextRunAt },
      update: { ...preferences, nextRunAt },
    });
    if (scheduledInputsChanged) {
      const canceled = await tx.contentJob.updateMany({
        where: {
          shop, status: "queued", outboxVersion: 1,
          scheduleClaim: { not: null },
        },
        data: {
          status: "failed",
          error: "Scheduled draft canceled: merchant changed automation settings before dispatch",
        },
      });
      if (canceled.count > 0) {
        await tx.storeConfig.update({
          where: { shop },
          data: {
            freeDraftsUsed: { decrement: canceled.count },
            // Replace the canceled due slot on the NEXT scheduled sweep,
            // not from this settings request. Never skip a whole cadence.
            ...(preferences.enabled ? { nextRunAt: new Date() } : {}),
          },
        });
      }
    }
    return true;
  });
}
