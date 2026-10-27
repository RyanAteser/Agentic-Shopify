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
 * Send one ALREADY CLAIMED job. No automatic retry, no redirects, no
 * refund. The caller handles only definitively rejected requests.
 * Kept separate from Shopify product discovery for transport fault tests.
 */
export async function deliverClaimedN8nJob({ shop, jobId, url, secret, body }: ClaimedN8nDelivery) {
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
    await markDeliveryUncertain(shop, jobId, "Transport outcome unknown; manual reconciliation needed");
    throw new UncertainDispatchError();
  }

  const outcome = classifyN8nDispatchStatus(response.status);
  if (outcome === "uncertain") {
    await markDeliveryUncertain(shop, jobId,
      "n8n HTTP " + response.status + "; acceptance unknown; reconcile execution");
    throw new UncertainDispatchError();
  }
  if (outcome === "rejected") {
    // Only a caller with a definitive rejection may invoke failCreditedJob.
    throw new Error("n8n rejected generation request (HTTP " + response.status + ")");
  }
}
