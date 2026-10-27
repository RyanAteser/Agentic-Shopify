import db from "../db.server";
import { classifyN8nDispatchStatus } from "./dispatch-claim.server";

/**
 * A lost HTTP response does not prove n8n rejected a paid generation job.
 * Keep the reserved credit and require reconciliation rather than replaying.
 */
export class UncertainDispatchError extends Error {
  constructor() {
    super("Could not confirm n8n acceptance. This job is awaiting reconciliation; no credit was refunded.");
    this.name = "UncertainDispatchError";
  }
}

export type ClaimedN8nDelivery = {
  shop: string;
  jobId: string;
  url: string;
  secret: string;
  body: unknown;
};

async function markDeliveryUncertain(shop: string, jobId: string, reason: string) {
  // A callback can win the race and complete the job before this HTTP
  // response arrives. Never revert a completed/failed/redacted job.
  await db.contentJob.updateMany({
    where: { id: jobId, shop, status: "running" },
    data: { status: "dispatch_uncertain", error: reason }
  });
}

/**
 * Failure to persist an ambiguous delivery status must never escape as a
 * generic error: callers refund generic errors, but n8n may have accepted
 * and charged for this request. The in-memory outcome remains uncertain
 * even when the database is unavailable.
 */
async function preserveUncertainOutcome(record: () => Promise<void>): Promise<never> {
  try {
    await record();
  } catch (error) {
    // Do not log merchant data, URLs, headers or credentials.
    console.error("Could not persist uncertain n8n delivery; refund remains prohibited",
      error instanceof Error ? error.name : "unknown");
  }
  throw new UncertainDispatchError();
}

/**
 * Send one ALREADY CLAIMED job. No automatic retry, no redirects, no
 * refund. The caller handles only definitively rejected requests.
 * Kept separate from Shopify product discovery for transport fault tests.
 */
export async function deliverClaimedN8nJob(
  { shop, jobId, url, secret, body }: ClaimedN8nDelivery,
  recordUncertain: typeof markDeliveryUncertain = markDeliveryUncertain
) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", "X-Agent-Key": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return preserveUncertainOutcome(() => recordUncertain(
      shop, jobId, "Transport outcome unknown; manual reconciliation needed"));
  }

  const outcome = classifyN8nDispatchStatus(response.status);
  if (outcome === "uncertain") {
    return preserveUncertainOutcome(() => recordUncertain(shop, jobId,
      "n8n HTTP " + response.status + "; acceptance unknown; reconcile execution"));
  }
  if (outcome === "rejected") {
    // Only a caller with a definitive rejection may invoke failCreditedJob.
    throw new Error("n8n rejected generation request (HTTP " + response.status + ")");
  }
}
