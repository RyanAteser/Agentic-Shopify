/** A deliberately narrow authorization boundary for a single-merchant catalog pilot.
 * Full Blog Agent/Store Manager mode remains unchanged unless explicitly enabled.
 * This guard is an addition to, not a replacement for, Shopify's SDK authentication.
 */
type PilotEnv = Record<string, string | undefined>;

export function readOnlyPilotEnabled(env: PilotEnv = process.env): boolean {
  return env.AGENTIC_PILOT_MODE === "read_only";
}

export function assertPilotConfiguration(env: PilotEnv = process.env): void {
  if (!env.AGENTIC_PILOT_MODE) return;
  if (env.AGENTIC_PILOT_MODE !== "read_only") {
    throw new Response("Unknown pilot mode", { status: 503 });
  }
  if (env.SCOPES !== "read_products") {
    throw new Response("Pilot must use read_products only", { status: 503 });
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(env.AGENTIC_PILOT_SHOP ?? "")) {
    throw new Response("Canonical pilot shop has not been configured", { status: 503 });
  }
}

export function assertPilotRequest(
  request: Pick<Request, "url" | "method">,
  env: PilotEnv = process.env,
): void {
  if (!env.AGENTIC_PILOT_MODE) return;
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
