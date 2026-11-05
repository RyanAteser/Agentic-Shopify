import type { ActionFunctionArgs } from "react-router";
import { authorizedBridge } from "../lib/agent.server";
import { validateN8nWebhookUrl } from "../lib/dispatch-claim.server";
import { recoverQueuedJobs } from "../lib/queued-recovery.server";

/**
 * Dedicated, bounded outbox sweep. The n8n workflow remains inactive until
 * an operator explicitly configures credentials and enables it.
 * Never auto-replay running, dispatch_uncertain, completed or legacy jobs.
 */
import { assertPilotServiceDisabled } from "../lib/pilot-readonly";

export const action = async ({ request }: ActionFunctionArgs) => {
  assertPilotServiceDisabled();
  if (!authorizedBridge(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const url = process.env.N8N_BLOG_WEBHOOK_URL;
  if (!url || !process.env.N8N_OUTBOUND_KEY) {
    return Response.json({ error: "n8n delivery not configured" }, { status: 503 });
  }
  try { validateN8nWebhookUrl(url); }
  catch { return Response.json({ error: "n8n delivery URL invalid" }, { status: 503 }); }
  try {
    const result = await recoverQueuedJobs();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Queued outbox recovery failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Recovery sweep unavailable" }, { status: 503 });
  }
};
