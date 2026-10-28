import db from "../db.server";
import { FREE_LIFETIME_GENERATIONS } from "./pricing";

/**
 * The scheduler's read is only a candidate snapshot. Claim the due slot,
 * lifetime free credit, topic cursor and job together under one store-row
 * write lock. A failed job insert rolls back every field.
 *
 * Never hold this transaction open during an n8n/Shopify network request.
 */
export type DueDraftSnapshot = {
  shop: string;
  blogId: string;
  enabled: boolean;
  nextRunAt: Date | null;
  topicCursor: number;
  cadenceDays: number;
  seedTopics: string;
  audience: string;
};

export type ScheduledDraftClaim = {
  shop: string;
  jobId: string;
  topic: string;
  previousNextRunAt: Date | null;
  nextRunAt: Date;
  previousCursor: number;
  blogId: string;
  cadenceDays: number;
  seedTopics: string;
};

function scheduledTopic(config: DueDraftSnapshot): string {
  const topics = config.seedTopics.split(",").map(t => t.trim()).filter(Boolean);
  const topic = topics.length
    ? topics[config.topicCursor % topics.length]
    : "Helpful practical guide for " + (config.audience || "our customers");
  return topic.slice(0, 140);
}

/**
 * Do not let permanently exhausted free plans monopolize the first ten due
 * rows. Merchant UI still shows the exhausted quota; billing is not enabled.
 */
export async function findDueScheduledDrafts(now = new Date()) {
  return db.storeConfig.findMany({
    where: {
      enabled: true, blogId: { not: "" },
      freeDraftsUsed: { lt: FREE_LIFETIME_GENERATIONS },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }]
    },
    take: 10, orderBy: { updatedAt: "asc" }
  });
}

export async function claimDueScheduledDraft(
  config: DueDraftSnapshot, now = new Date()
): Promise<ScheduledDraftClaim | null> {
  if (!Number.isFinite(now.getTime()) || !config.enabled || !config.blogId ||
      !Number.isSafeInteger(config.topicCursor) || config.topicCursor < 0 ||
      (config.nextRunAt !== null && config.nextRunAt.getTime() > now.getTime())) {
    return null;
  }
  const cadence = Math.max(1, Math.min(30, config.cadenceDays));
  const nextRunAt = new Date(now.getTime() + cadence * 86_400_000);
  const topic = scheduledTopic(config);
  return db.$transaction(async tx => {
    const claim = await tx.storeConfig.updateMany({
      where: {
        shop: config.shop, enabled: true, blogId: config.blogId,
        nextRunAt: config.nextRunAt,
        topicCursor: config.topicCursor, cadenceDays: config.cadenceDays,
        seedTopics: config.seedTopics,
        freeDraftsUsed: { lt: FREE_LIFETIME_GENERATIONS },
        AND: [{ OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }],
      },
      data: {
        nextRunAt, topicCursor: { increment: 1 },
        freeDraftsUsed: { increment: 1 }
      }
    });
    if (claim.count !== 1) return null;
    const job = await tx.contentJob.create({ data: { shop: config.shop, topic } });
    return {
      shop: config.shop, jobId: job.id, topic,
      previousNextRunAt: config.nextRunAt, nextRunAt,
      previousCursor: config.topicCursor,
      blogId: config.blogId, cadenceDays: config.cadenceDays,
      seedTopics: config.seedTopics
    };
  });
}

/**
 * Only a definitive rejection before n8n accepts work may be refunded.
 * A callback, timeout, uncertain dispatch or a redacted store must not be
 * rolled back. Schedule rewind is conditional on unchanged merchant settings:
 * a merchant edit must never be undone by a late delivery failure.
 *
 * Rewind does not trigger a retry now. The next scheduled hourly sweep may
 * claim the due slot, once the operator has fixed the integration.
 */
export async function failScheduledDraft(
  claim: ScheduledDraftClaim, error: unknown
): Promise<boolean> {
  return db.$transaction(async tx => {
    const active = await tx.storeConfig.updateMany({
      where: { shop: claim.shop }, data: { updatedAt: new Date() }
    });
    if (active.count !== 1) return false;
    const failed = await tx.contentJob.updateMany({
      where: { id: claim.jobId, shop: claim.shop, status: { in: ["queued", "running"] } },
      data: { status: "failed", error: String(error).slice(0, 400) }
    });
    if (failed.count !== 1) return false;
    await tx.storeConfig.update({
      where: { shop: claim.shop }, data: { freeDraftsUsed: { decrement: 1 } }
    });
    await tx.storeConfig.updateMany({
      where: {
        shop: claim.shop, enabled: true, blogId: claim.blogId,
        cadenceDays: claim.cadenceDays, seedTopics: claim.seedTopics,
        nextRunAt: claim.nextRunAt, topicCursor: claim.previousCursor + 1
      },
      data: {
        nextRunAt: claim.previousNextRunAt,
        topicCursor: { decrement: 1 }
      }
    });
    return true;
  });
}
