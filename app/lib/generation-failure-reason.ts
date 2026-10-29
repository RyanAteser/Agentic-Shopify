import { ProductContextUnavailableError } from "./product-context.server";

/**
 * Generation errors can contain raw Shopify/Prisma/n8n payloads, shop URLs,
 * prompt fragments or credentials. Job.error is persistent and can appear in
 * merchant/operator UI. Store only a fixed, actionable category, never the
 * arbitrary Error.message or String(error).
 *
 * Callers must independently prove the failure is definitive before invoking
 * their refund path. This function only minimizes stored error data.
 */
const DEFINITIVE_N8N_REJECTION =
  /^n8n rejected generation request \(HTTP (400|401|403|404|405|410|413|415|422)\)$/;

export function safeGenerationFailureReason(error: unknown): string {
  if (error instanceof ProductContextUnavailableError) {
    return "Shopify product context unavailable; generation was not dispatched.";
  }
  if (error instanceof Error) {
    if (error.message === "n8n integration is not configured") {
      return "n8n generation integration is not configured.";
    }
    if (error.message === "Select a Shopify blog first") {
      return "No Shopify destination blog selected.";
    }
    const rejected = DEFINITIVE_N8N_REJECTION.exec(error.message);
    if (rejected) {
      return "n8n rejected generation request (HTTP " + rejected[1] + ").";
    }
  }
  return "Generation failed before confirmed acceptance; operator review required.";
}
