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
