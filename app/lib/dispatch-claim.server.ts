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

export async function claimQueuedDispatch(shop: string, jobId: string): Promise<void> {
  const result = await db.contentJob.updateMany({
    where: { id: jobId, shop, status: "queued" },
    data: { status: "running" }
  });
  if (result.count !== 1) throw new DispatchAlreadyClaimedError();
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
