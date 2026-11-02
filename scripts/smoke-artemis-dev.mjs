#!/usr/bin/env node
// Read-only smoke check. Never supplies Shopify credentials or installs an app.
// A 410 response to Node's default user-agent is bot filtering, NOT auth evidence.
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

// Simulate an ordinary unauthenticated browser, not Node/undici's bot user-agent.
const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
};
const request = (url) => fetch(url, {
  headers: browserHeaders,
  redirect: "manual",
  signal: AbortSignal.timeout(15000),
});

const health = await request(new URL("/health", origin));
assert.equal(health.status, 200, "/health must return HTTP 200");
assert.deepEqual(await health.json(), { status: "ready" });
console.log("PASS: database-backed health endpoint");

const loginUrl = new URL("/auth/login", origin);
loginUrl.searchParams.set("shop", shop);
const login = await request(loginUrl);
assert.ok(login.status >= 300 && login.status < 400, "login must redirect");
const location = login.headers.get("location");
assert.ok(location, "login must include a Location header");
const target = new URL(location, origin);
assert.equal(target.protocol, "https:");
assert.equal(target.hostname, "admin.shopify.com");
assert.match(target.pathname, /\/oauth\/install$/);
assert.match(target.searchParams.get("client_id") ?? "", /^[a-f0-9]{32}$/);
console.log("PASS: unauthenticated login redirects to Shopify managed installation");

// For browser requests without a signed ID token, the SDK may render an
// App Bridge-only bootstrap response (HTTP 200) before acquiring a session.
// Such a page must NOT contain merchant dashboard data. It is not a UI pass.
for (const path of ["/app", "/app/team", "/app/manager", "/app/seo", "/app/growth"]) {
  const url = new URL(path, origin);
  url.searchParams.set("shop", shop);
  const response = await request(url);
  if (response.status === 200) {
    const html = await response.text();
    assert.match(html, /cdn\.shopify\.com\/shopifycloud\/app-bridge\.js/,
      `Missing App Bridge token bootstrap at ${path}`);
    assert.doesNotMatch(html, /<s-page\b|<s-section\b|Store overview|Draft review queue/,
      `Unauthenticated ${path} exposed dashboard content`);
    const csp = response.headers.get("content-security-policy") || "";
    assert.match(csp, /frame-ancestors[^;]*admin\.shopify\.com/,
      `Missing Shopify Admin framing policy at ${path}`);
  } else {
    assert.ok([302, 303, 307, 308, 401, 403].includes(response.status),
      `Unexpected unauthenticated browser response for ${path}: ${response.status}`);
  }
}
console.log("PASS: unauthenticated browser requests use safe App Bridge bootstrap or auth responses");

// Deliberately identifying as a bot exercises a different SDK code path.
// Its 410 Gone must never be presented as evidence of working auth.
const botUrl = new URL("/app", origin);
botUrl.searchParams.set("shop", shop);
const botResponse = await fetch(botUrl, {
  redirect: "manual",
  headers: { "User-Agent": "node" },
  signal: AbortSignal.timeout(15000),
});
assert.equal(botResponse.status, 410, "Expected SDK's bot-specific 410 response");
console.log("PASS: bot-only 410 distinguished from unauthenticated browser bootstrap");
console.log("NOTE: authenticated Shopify Admin rendering and API calls require a real embedded browser session.");
