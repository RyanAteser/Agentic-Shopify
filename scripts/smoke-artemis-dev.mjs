#!/usr/bin/env node
// Read-only smoke check. Never supplies Shopify credentials or performs installation.
import assert from "node:assert/strict";

const [base, shop = "artemisti.myshopify.com"] = process.argv.slice(2);
if (!base) {
  console.error("Usage: node scripts/smoke-artemis-dev.mjs <dev-origin> [shop]");
  process.exit(2);
}
const origin = new URL(base);
assert.ok(["http:", "https:"].includes(origin.protocol));
assert.equal(origin.pathname, "/");
assert.match(shop, /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/);

const health = await fetch(new URL("/health", origin), {
  redirect: "manual", signal: AbortSignal.timeout(15000),
});
assert.equal(health.status, 200, "/health must return HTTP 200");
assert.deepEqual(await health.json(), { status: "ready" });
console.log("PASS: database-backed health endpoint");

const loginUrl = new URL("/auth/login", origin);
loginUrl.searchParams.set("shop", shop);
const login = await fetch(loginUrl, {
  redirect: "manual", signal: AbortSignal.timeout(15000),
});
assert.ok(login.status >= 300 && login.status < 400, "login must redirect");
const location = login.headers.get("location");
assert.ok(location, "login must include a Location header");
const target = new URL(location, origin);
assert.equal(target.protocol, "https:");
assert.equal(target.hostname, "admin.shopify.com");
assert.match(target.pathname, /\/oauth\/install$/);
assert.match(target.searchParams.get("client_id") ?? "", /^[a-f0-9]{32}$/);
console.log("PASS: unauthenticated login redirects to Shopify managed installation");
console.log("NOTE: full Shopify session/token exchange still requires an authenticated browser test.");
