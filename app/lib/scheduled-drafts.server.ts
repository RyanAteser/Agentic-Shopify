import db from "../db.server";
import { FREE_LIFETIME_GENERATIONS } from "./pricing";
import { safeGenerationFailureReason } from "./generation-failure-reason";

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
  brandVoice: string;
  authorName: string;
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

/**
 * Persist the exact schedule claim with the queued job. A recovery sweep can
 * refund a definite pre-acceptance rejection without guessing merchant state.
 * Legacy jobs have no snapshot and are deliberately excluded from recovery.
 */
export function scheduledClaimFromJob(job: {
  id: string; shop: string; topic: string; scheduleClaim: string | null
}): ScheduledDraftClaim | null {
  if (job.scheduleClaim === null) return null;
  let value: unknown;
  try { value = JSON.parse(job.scheduleClaim); }
  catch { throw new Error("Corrupt scheduled outbox snapshot"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Corrupt scheduled outbox snapshot");
  }
  const v = value as Record<string, unknown>;
  const isUtcTimestamp = (value: unknown): value is string =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
  if ((v.previousNextRunAt !== null && !isUtcTimestamp(v.previousNextRunAt)) ||
      !isUtcTimestamp(v.nextRunAt)) {
    throw new Error("Corrupt scheduled outbox snapshot");
  }
  const previous = v.previousNextRunAt === null ? null : new Date(v.previousNextRunAt as string);
  const next = new Date(v.nextRunAt as string);
  if ((previous !== null && !Number.isFinite(previous.getTime())) ||
      !Number.isFinite(next.getTime()) ||
      typeof v.previousCursor !== "number" || !Number.isSafeInteger(v.previousCursor) || v.previousCursor < 0 ||
      typeof v.cadenceDays !== "number" || !Number.isInteger(v.cadenceDays) || v.cadenceDays < 1 ||
      v.cadenceDays > 30 ||
      typeof v.blogId !== "string" || !v.blogId ||
      typeof v.seedTopics !== "string") {
    throw new Error("Corrupt scheduled outbox snapshot");
  }
  return {
    shop: job.shop, jobId: job.id, topic: job.topic,
    previousNextRunAt: previous, nextRunAt: next,
    previousCursor: v.previousCursor as number,
    blogId: v.blogId, cadenceDays: v.cadenceDays as number,
    seedTopics: v.seedTopics
  };
}

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
        // A merchant can edit the brief after the scheduler reads a candidate.
        // Match all prompt inputs, not just the topic list, before reserving
        // a credit. Otherwise an old audience fallback topic can be queued.
        audience: config.audience,
        brandVoice: config.brandVoice,
        authorName: config.authorName,
        freeDraftsUsed: { lt: FREE_LIFETIME_GENERATIONS },
        AND: [{ OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }],
      },
      data: {
        nextRunAt, topicCursor: { increment: 1 },
        freeDraftsUsed: { increment: 1 }
      }
    });
    if (claim.count !== 1) return null;
    const scheduleClaim = JSON.stringify({
      previousNextRunAt: config.nextRunAt?.toISOString() ?? null,
      nextRunAt: nextRunAt.toISOString(), previousCursor: config.topicCursor,
      blogId: config.blogId, cadenceDays: config.cadenceDays,
      seedTopics: config.seedTopics
    });
    const job = await tx.contentJob.create({
      data: { shop: config.shop, topic, outboxVersion: 1, scheduleClaim }
    });
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
 * Only a known pre-POST failure or independently reconciled rejection may
 * be refunded. HTTP errors after a POST are uncertain. A callback, timeout,
 * uncertain dispatch or a redacted store must not be
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
      data: { status: "failed", error: safeGenerationFailureReason(error) }
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
