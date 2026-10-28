import db from "../db.server";
import { UncertainDispatchError } from "./n8n-delivery.server";
import { DispatchAlreadyClaimedError } from "./dispatch-claim.server";
import { failCreditedJob } from "./credits.server";
import { failScheduledDraft, scheduledClaimFromJob } from "./scheduled-drafts.server";

/**
 * Recovery is safe ONLY for newly versioned jobs still in "queued" state.
 * The first dispatch step atomically transitions queued -> running BEFORE
 * product discovery or any n8n POST. Running/uncertain jobs must never replay.
 * Legacy queued jobs predate this invariant and require operator inspection.
 */
export const QUEUED_RECOVERY_MIN_AGE_MS = 5 * 60_000;
export const QUEUED_RECOVERY_BATCH = 3;

type Dispatch = (jobId: string, shop: string) => Promise<void>;

// Avoid initializing Shopify SDK in pure database recovery tests. Production
// imports the actual publisher only when a queued job is selected for dispatch.
const dispatchProduction: Dispatch = async (jobId, shop) => {
  const { dispatchArticleJob } = await import("./agent.server");
  await dispatchArticleJob(jobId, shop);
};

export async function recoverQueuedJobs(
  now = new Date(), dispatch: Dispatch = dispatchProduction
) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid recovery clock");
  const cutoff = new Date(now.getTime() - QUEUED_RECOVERY_MIN_AGE_MS);
  const jobs = await db.contentJob.findMany({
    where: { status: "queued", outboxVersion: 1, createdAt: { lte: cutoff } },
    select: { id: true, shop: true, topic: true, scheduleClaim: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: QUEUED_RECOVERY_BATCH
  });
  let accepted = 0, uncertain = 0, rejected = 0, raced = 0, blocked = 0;
  for (const job of jobs) {
    // Check the durable schedule metadata BEFORE dispatch. Never send a job
    // whose refund/rewind contract is corrupted.
    let schedule;
    try { schedule = scheduledClaimFromJob(job); }
    catch {
      // Quarantine corrupt rows rather than letting the oldest three block
      // every later merchant indefinitely. Keep the credit and full record.
      try {
        await db.contentJob.updateMany({
          where: { id: job.id, shop: job.shop, status: "queued", outboxVersion: 1 },
          data: { outboxVersion: 0, error: "Recovery quarantined: invalid schedule metadata" }
        });
      } catch {
        console.error("Could not quarantine corrupt queued recovery metadata");
      }
      blocked++;
      console.error("Queued recovery blocked by corrupt schedule metadata");
      continue;
    }
    try {
      await dispatch(job.id, job.shop);
      accepted++;
    } catch (error) {
      if (error instanceof DispatchAlreadyClaimedError) {
        raced++; // Another worker or a completed callback won the claim.
        continue;
      }
      if (error instanceof UncertainDispatchError) {
        uncertain++; // n8n may already be processing the job.
        continue;
      }
      // The production dispatch function only throws a generic error before
      // network acceptance or on a definitive permanent HTTP rejection.
      // Lock merchant first, then conditionally fail/refund; a callback that
      // already completed cannot be undone.
      try {
        const refunded = schedule
          ? await failScheduledDraft(schedule, error)
          : await failCreditedJob(job.shop, job.id, error);
        if (refunded) rejected++;
        else raced++;
      } catch {
        blocked++;
        console.error("Queued recovery could not persist definitive failure");
      }
    }
  }
  return { candidates: jobs.length, accepted, uncertain, rejected, raced, blocked };
}
