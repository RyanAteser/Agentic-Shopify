/** A deliberately narrow authorization boundary for a single-merchant catalog pilot.
 * Full Blog Agent/Store Manager mode remains unchanged unless explicitly enabled.
 * This guard is an addition to, not a replacement for, Shopify's SDK authentication.
 */
type PilotEnv = Record<string, string | undefined>;

export function readOnlyPilotEnabled(env: PilotEnv = process.env): boolean {
  // A partially configured single-merchant pilot must never become the
  // unrestricted full application because one mode variable was omitted.
  // Presence, rather than truthiness, also catches empty staged variables.
  const hasPilotMarker = ["AGENTIC_PILOT_MODE", "AGENTIC_PILOT_SHOP",
    "AGENTIC_PILOT_CLIENT_ID"].some(key => env[key] !== undefined);
  if (hasPilotMarker && env.AGENTIC_PILOT_MODE !== "read_only") {
    throw new Response("Incomplete or unsupported pilot mode", { status: 503 });
  }
  return env.AGENTIC_PILOT_MODE === "read_only";
}

export function assertPilotConfiguration(env: PilotEnv = process.env): void {
  if (!readOnlyPilotEnabled(env)) return;
  if (env.AGENTIC_PILOT_MODE !== "read_only") {
    throw new Response("Unknown pilot mode", { status: 503 });
  }
  if (env.SCOPES !== "read_products") {
    throw new Response("Pilot must use read_products only", { status: 503 });
  }
  // Separate test/public Shopify apps must not silently inherit Artemis keys.
  // Public app client identifiers are not secrets, but must match exactly.
  if (!/^[a-f0-9]{32}$/.test(env.AGENTIC_PILOT_CLIENT_ID ?? "") ||
      env.SHOPIFY_API_KEY !== env.AGENTIC_PILOT_CLIENT_ID) {
    throw new Response("Pilot Shopify app identity mismatch", { status: 503 });
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(env.AGENTIC_PILOT_SHOP ?? "")) {
    throw new Response("Canonical pilot shop has not been configured", { status: 503 });
  }
}

export function assertPilotRequest(
  request: Pick<Request, "url" | "method">,
  env: PilotEnv = process.env,
): void {
  if (!readOnlyPilotEnabled(env)) return;
  assertPilotConfiguration(env);
  const path = new URL(request.url).pathname;
  // Shopify manages /auth/... callbacks/session negotiation. All merchant
  // application routes except the catalog are unavailable in pilot mode.
  if (path === "/app/catalog" && request.method === "GET") return;
  if ((path === "/auth" || path.startsWith("/auth/")) &&
      (request.method === "GET" || request.method === "POST")) return;
  throw new Response("Unavailable in read-only pilot", { status: 403 });
}

export function assertPilotShop(
  authenticatedShop: string,
  env: PilotEnv = process.env,
): void {
  if (!readOnlyPilotEnabled(env)) return;
  assertPilotConfiguration(env);
  if (authenticatedShop.toLowerCase() !== env.AGENTIC_PILOT_SHOP) {
    throw new Response("Wrong merchant for this pilot", { status: 403 });
  }
}

/** Stop privileged background bridges, GSC OAuth and token-bearing callbacks
 * before they read or mutate any merchant state. Shopify privacy webhooks
 * are separate, authenticated handlers and must remain operational.
 */
export function assertPilotServiceDisabled(env: PilotEnv = process.env): void {
  if (!readOnlyPilotEnabled(env)) return;
  assertPilotConfiguration(env);
  throw new Response("Unavailable in read-only pilot", { status: 403 });
}

/** The effective Shopify session grant can differ from requested env scopes.
 * Require the installed app's actual token/session permission set to remain
 * exactly catalog-read-only, even after a Shopify scope-update webhook.
 */
export function assertPilotSessionScopes(
  granted: string | undefined,
  env: PilotEnv = process.env,
): void {
  if (!readOnlyPilotEnabled(env)) return;
  assertPilotConfiguration(env);
  if (granted !== "read_products") {
    throw new Response("Unexpected Shopify session scopes", { status: 403 });
  }
}
