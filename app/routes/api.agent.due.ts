import type { ActionFunctionArgs } from "react-router";
import { authorizedBridge, dispatchArticleJob, UncertainDispatchError } from "../lib/agent.server";
import { DispatchAlreadyClaimedError } from "../lib/dispatch-claim.server";
import { claimDueScheduledDraft, failScheduledDraft, findDueScheduledDrafts } from "../lib/scheduled-drafts.server";

/**
 * Hourly, authenticated n8n trigger. The due slot, free credit and ContentJob
 * are committed atomically, not advanced before a separate credit reservation.
 * Failed/expired free plans cannot occupy all ten selected slots indefinitely.
 * This endpoint only creates drafts; it never publishes Shopify content.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorizedBridge(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const now = new Date();
  const configs = await findDueScheduledDrafts(now);
  let launched = 0, failed = 0;
  for (const config of configs) {
    try {
      const claim = await claimDueScheduledDraft(config, now);
      if (!claim) continue; // Lost a concurrent claim or merchant changed settings.
      try {
        await dispatchArticleJob(claim.jobId, config.shop);
        launched++;
      } catch (error) {
        // A lost HTTP response is NOT proof of rejection. Do not rewind the
        // schedule, refund, or retry an uncertain dispatch.
        if (!(error instanceof UncertainDispatchError) &&
            !(error instanceof DispatchAlreadyClaimedError)) {
          await failScheduledDraft(claim, error);
        }
        failed++;
        console.error("Scheduled draft delivery failed for", config.shop,
          error instanceof Error ? error.name : "unknown");
      }
    } catch (error) {
      failed++;
      console.error("Scheduled draft reservation failed for", config.shop,
        error instanceof Error ? error.name : "unknown");
    }
  }
  return Response.json({ dueStores: configs.length, launched, failed });
};
