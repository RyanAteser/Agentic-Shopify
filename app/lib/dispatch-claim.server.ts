import db from "../db.server";

/**
 * A job can be dispatched at most once. An uncertain HTTP outcome is NOT a
 * reason to requeue: n8n may already have accepted and billed the work.
 */
export class DispatchAlreadyClaimedError extends Error {
  constructor() {
    super("This generation job was already dispatched or is no longer queued; reconcile its existing status instead of retrying.");
    this.name = "DispatchAlreadyClaimedError";
  }
}

export type DispatchConfigSnapshot = {
  blogId: string;
  audience: string;
  brandVoice: string;
  seedTopics: string;
  authorName: string;
};

/**
 * The caller prepares the prompt and product context BEFORE claiming the job.
 * Compare the merchant settings under the same store lock used by settings edits,
 * so a preflight from an old browser/worker cannot dispatch an obsolete brief.
 */
export async function claimQueuedDispatch(
  shop: string, jobId: string, expectedConfig?: DispatchConfigSnapshot
): Promise<void> {
  await db.$transaction(async tx => {
    // Serialize with merchant preference changes and privacy redaction.
    // A disable/edit that commits first cancels queued scheduled work before
    // this claim can send it to n8n. Manual jobs remain independent of the
    // scheduler's enabled flag.
    const active = await tx.storeConfig.updateMany({
      where: { shop }, data: { updatedAt: new Date() }
    });
    if (active.count !== 1) throw new DispatchAlreadyClaimedError();
    const job = await tx.contentJob.findUnique({
      where: { id: jobId },
      select: { shop: true, status: true, scheduleClaim: true }
    });
    if (!job || job.shop !== shop || job.status !== "queued")
      throw new DispatchAlreadyClaimedError();
    const config = await tx.storeConfig.findUnique({
      where: { shop },
      select: {
        enabled: true, blogId: true, audience: true, brandVoice: true,
        seedTopics: true, authorName: true
      }
    });
    if (!config || (job.scheduleClaim !== null && !config.enabled)) {
      throw new DispatchAlreadyClaimedError();
    }
    if (expectedConfig && (
      config.blogId !== expectedConfig.blogId ||
      config.audience !== expectedConfig.audience ||
      config.brandVoice !== expectedConfig.brandVoice ||
      config.seedTopics !== expectedConfig.seedTopics ||
      config.authorName !== expectedConfig.authorName
    )) {
      // Leave the credit and job queued. A recovery sweep can safely prepare
      // a fresh brief; no n8n request has been made.
      throw new DispatchAlreadyClaimedError();
    }
    const result = await tx.contentJob.updateMany({
      where: { id: jobId, shop, status: "queued" },
      data: { status: "running" }
    });
    if (result.count !== 1) throw new DispatchAlreadyClaimedError();
  });
}

/** Prevent a misleading localhost prefix from authorizing plaintext exfiltration. */
export function validateN8nWebhookUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid n8n webhook URL");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.hash) {
    throw new Error("n8n webhook must use HTTPS (plain HTTP only for exact loopback hosts), without embedded credentials or fragments");
  }
}


/**
 * Only explicit permanent request rejections are safe to refund. HTTP 408,
 * 409, 425, 429, redirects and 5xx are not proof that n8n did not start a
 * workflow, especially when a proxy is between the app and n8n.
 * Never automatically retry an uncertain generation request.
 */
export function classifyN8nDispatchStatus(status: number): "accepted" | "rejected" | "uncertain" {
  if (Number.isInteger(status) && status >= 200 && status < 300) return "accepted";
  if ([400, 401, 403, 404, 405, 410, 413, 415, 422].includes(status)) return "rejected";
  return "uncertain";
}

/** Advisory only: age is not proof of failure and does not mutate a job. */
export function generationJobNotice(status: string, updatedAt: Date, now = new Date()): string | null {
  if (status === "dispatch_uncertain") {
    return "Delivery was not confirmed. An operator must inspect the n8n execution before retrying or refunding.";
  }
  if (["queued", "running"].includes(status) &&
      Number.isFinite(updatedAt.getTime()) &&
      now.getTime() - updatedAt.getTime() >= 30 * 60_000) {
    return "No completion confirmed for at least 30 minutes. Check n8n execution and callback history; do not blindly retry.";
  }
  return null;
}
