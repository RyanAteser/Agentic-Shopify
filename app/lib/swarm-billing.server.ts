import {verifiedSwarmPlan, type SwarmPlan} from "./swarm-policy";

type ReadOnlyAdmin = {
  graphql: (query: string) => Promise<{json: () => Promise<unknown>}>;
};

/**
 * No charges are created here. The existing Blog Agent prices remain separate.
 * Paid swarm allocations are disabled until Shopify billing is verified.
 */
export async function resolveSwarmEntitlement(
  admin: ReadOnlyAdmin,
  env: Record<string, string | undefined> = process.env,
): Promise<SwarmPlan> {
  if (env.SWARM_BILLING_ENABLED !== "true") return "free";
  try {
    const reply = await admin.graphql(
      "query VerifiedSwarmSubscription { currentAppInstallation { activeSubscriptions { id name status } } }"
    );
    const data = await reply.json() as {
      errors?: unknown[];
      data?: {currentAppInstallation?: {activeSubscriptions?: unknown}};
    };
    if (data.errors?.length || !Array.isArray(data.data?.currentAppInstallation?.activeSubscriptions)) {
      return "free"; // Fail closed on missing/stale data.
    }
    return verifiedSwarmPlan(data.data.currentAppInstallation.activeSubscriptions, true);
  } catch {
    return "free";
  }
}
