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
 * An HTTP success code alone is not proof that the intended n8n execution
 * accepted THIS job. The pinned workflow must echo both tenant and job ID
 * from its authenticated webhook, before any paid generation step.
 * The bounded body read prevents an unexpectedly large proxy response from
 * becoming a memory hazard. This is an acceptance signal, NOT a durable
 * n8n execution record or exactly-once guarantee.
 */
async function hasMatchingN8nAck(response: Response, shop: string, jobId: string): Promise<boolean> {
  if (response.status !== 202 ||
      !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) {
    return false;
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > 2048) return false;
  if (!response.body) return false;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) {
        await reader.cancel().catch(() => undefined);
        return false;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const ack: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!ack || typeof ack !== "object" || Array.isArray(ack)) return false;
    const value = ack as Record<string, unknown>;
    return value.accepted === true && value.jobId === jobId && value.shop === shop;
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Send one ALREADY CLAIMED job. No automatic retry, no redirects, no
 * status-only refund. Callers may refund only known pre-POST failures.
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
  // A 4xx is not a verifiable rejection receipt. It may come from a proxy
  // or a workflow that already started paid work, so never refund on status.
  // 2xx without a matching 202 job-specific acknowledgment is ambiguous,
  // not an accepted generation. Never refund or send the same job again.
  if (!(await hasMatchingN8nAck(response, shop, jobId))) {
    return preserveUncertainOutcome(() => recordUncertain(shop, jobId,
      "n8n response lacked matching job acceptance acknowledgment; reconcile execution"));
  }
}
