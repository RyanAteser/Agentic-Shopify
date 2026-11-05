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
  }
  return "Generation failed before confirmed acceptance; operator review required.";
}
