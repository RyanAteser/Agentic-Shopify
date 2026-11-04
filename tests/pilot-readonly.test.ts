import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readOnlyPilotEnabled, assertPilotConfiguration, assertPilotServiceDisabled, assertPilotSessionScopes,
  assertPilotRequest, assertPilotShop
} from "../app/lib/pilot-readonly";

const pilot = {
  AGENTIC_PILOT_MODE: "read_only",
  AGENTIC_PILOT_SHOP: "monika-test.myshopify.com",
  SCOPES: "read_products",
  SHOPIFY_API_KEY: "a".repeat(32),
  SHOPIFY_API_SECRET: "ci-only-fake-secret-32-characters",
  SHOPIFY_APP_URL: "https://pilot.example.invalid",
  AGENTIC_PILOT_CLIENT_ID: "a".repeat(32),
};
const req = (path: string, method = "GET") =>
  ({ method, url: "https://pilot.example" + path });
const status = (code: number) => (error: unknown) =>
  error instanceof Response && error.status === code;

test("partial pilot environment cannot silently enable the full app", () => {
  const partial = [
    { ...pilot, AGENTIC_PILOT_MODE: undefined },
    { ...pilot, AGENTIC_PILOT_MODE: "" },
    { ...pilot, AGENTIC_PILOT_MODE: "disabled" },
    { AGENTIC_PILOT_SHOP: pilot.AGENTIC_PILOT_SHOP },
    { AGENTIC_PILOT_CLIENT_ID: pilot.AGENTIC_PILOT_CLIENT_ID },
    { AGENTIC_PILOT_CLIENT_ID: "" },
  ];
  for (const env of partial) {
    assert.throws(() => readOnlyPilotEnabled(env), status(503));
    assert.throws(() => assertPilotConfiguration(env), status(503));
    assert.throws(() => assertPilotRequest(req("/app/catalog"), env), status(503));
    assert.throws(() => assertPilotRequest(req("/app/manager"), env), status(503));
    assert.throws(() => assertPilotShop(pilot.AGENTIC_PILOT_SHOP, env), status(503));
    assert.throws(() => assertPilotSessionScopes("read_products", env), status(503));
    assert.throws(() => assertPilotServiceDisabled(env), status(503));
  }
  // No pilot markers preserves the independent full-app default.
  assert.equal(readOnlyPilotEnabled({}), false);
  assert.doesNotThrow(() => assertPilotConfiguration({}));
});

test("pilot activation requires exact read-only scope and a canonical shop", () => {
  assert.equal(readOnlyPilotEnabled(pilot), true);
  assert.doesNotThrow(() => assertPilotConfiguration(pilot));
  assert.throws(() => assertPilotConfiguration({...pilot, SCOPES:"read_products,write_content"}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, SCOPES:""}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, SHOPIFY_API_KEY:"b".repeat(32)}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, AGENTIC_PILOT_CLIENT_ID:undefined}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, AGENTIC_PILOT_SHOP:"example.com"}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, AGENTIC_PILOT_SHOP:undefined}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, AGENTIC_PILOT_MODE:"unsafe"}), status(503));
});

test("pilot readiness rejects missing credentials and malformed callback origins", () => {
  // Shopify authenticates against these runtime settings. Readiness does not
  // prove credentials match the Dev Dashboard; it must reject absent values.
  for (const secret of [undefined, "", "short", "  ", " ci-only-fake-secret-32-characters "]) {
    assert.throws(() => assertPilotConfiguration({...pilot, SHOPIFY_API_SECRET: secret}), status(503));
  }
  for (const appUrl of [
    undefined, "", "http://pilot.example.invalid",
    "https://localhost", "https://127.0.0.1",
    "https://pilot.example.invalid:8443",
    "https://user:pass@pilot.example.invalid",
    "https://pilot.example.invalid/app/catalog",
    "https://pilot.example.invalid/?shop=other",
    "https://pilot.example.invalid/#fragment",
    "https://pilot.example.invalid.evil.invalid/path",
  ]) {
    assert.throws(() => assertPilotConfiguration({...pilot, SHOPIFY_APP_URL: appUrl}), status(503));
  }
  assert.doesNotThrow(() => assertPilotConfiguration({...pilot, SHOPIFY_APP_URL: "https://pilot.example.invalid/"}));
  assert.doesNotThrow(() => assertPilotRequest(req("/app/catalog"), pilot));
});

test("catalog-only route gate denies all other application reads and writes", () => {
  assert.doesNotThrow(() => assertPilotRequest(req("/app/catalog"), pilot));
  assert.doesNotThrow(() => assertPilotRequest(req("/app/catalog?shop=attacker.myshopify.com"), pilot));
  assert.doesNotThrow(() => assertPilotRequest(req("/auth/callback"), pilot));
  assert.doesNotThrow(() => assertPilotRequest(req("/auth/session-token","POST"), pilot));
  for (const [path, method] of [
    ["/app", "GET"], ["/app/seo","GET"], ["/app/manager","GET"],
    ["/app/growth","GET"], ["/app/catalog","POST"],
    ["/app","POST"], ["/app/team","POST"], ["/api/agent/due","POST"],
    ["/auth/callback","DELETE"],
  ]) {
    assert.throws(() => assertPilotRequest(req(path, method), pilot), status(403), path + " " + method);
  }
  assert.throws(() => assertPilotRequest(req("/app/catalog"), {...pilot, AGENTIC_PILOT_MODE:"typo"}), status(503));
});

test("session shop, not query string or user form, determines tenant authorization", () => {
  assert.doesNotThrow(() => assertPilotShop("monika-test.myshopify.com",pilot));
  assert.throws(() => assertPilotShop("other.myshopify.com",pilot),status(403));
  assert.throws(() => assertPilotShop("",pilot),status(403));
  // Other app instances remain unchanged when pilot mode is not set.
  assert.equal(readOnlyPilotEnabled({}),false);
  assert.doesNotThrow(() => assertPilotRequest(req("/app","POST"),{}));
});

test("the single-merchant config is inert until operator credential and host binding", () => {
  const toml=readFileSync(new URL("../shopify.app.monika-pilot.example.toml", import.meta.url),"utf8");
  const server=readFileSync(new URL("../app/shopify.server.ts",import.meta.url),"utf8");
  assert.match(toml, /^scopes = "read_products"$/m);
  assert.doesNotMatch(toml,/write_content|write_products|read_orders|read_customers/);
  assert.match(toml,/client_id = ""/);
  assert.match(toml,/example.com\/app\/catalog/);
  assert.match(server,/AppDistribution.SingleMerchant/);
  assert.match(server,/assertPilotRequest\(args\[0\]\)/);
  assert.match(server,/assertPilotShop\(context.session.shop\)/);
});

test("privileged background endpoints always refuse a catalog-only pilot", () => {
  assert.throws(() => assertPilotServiceDisabled(pilot), status(403));
  assert.throws(() => assertPilotServiceDisabled({...pilot, AGENTIC_PILOT_MODE: "unsafe"}), status(503));
  assert.doesNotThrow(() => assertPilotServiceDisabled({}));
  for (const route of [
    "api.agent.complete.ts", "api.agent.due.ts", "api.agent.recover.ts",
    "api.growth.sync.ts", "api.manager.sync.ts", "api.seo.rankings.ts",
    "auth.google.callback.ts", "app.growth.connect.ts"
  ]) {
    const source=readFileSync(new URL("../app/routes/"+route, import.meta.url),"utf8");
    const importAt=source.indexOf("import { assertPilotServiceDisabled }");
    const handlerAt=source.indexOf("export const ",importAt);
    const gateAt=source.indexOf("assertPilotServiceDisabled();",handlerAt);
    assert.ok(importAt>=0 && handlerAt>=0 && gateAt>handlerAt, route+" missing service gate");
    assert.ok(gateAt-handlerAt<180, route+" service gate must precede effects");
  }
});

test("Shopify lifecycle webhooks verify signed tenant before state changes", () => {
  for (const route of [
    "webhooks.app.uninstalled.tsx", "webhooks.shop.redact.ts",
    "webhooks.customers.data_request.ts", "webhooks.customers.redact.ts",
    "webhooks.app.scopes_update.tsx"
  ]) {
    const source=readFileSync(new URL("../app/routes/"+route,import.meta.url),"utf8");
    assert.match(source, /assertPilotShop\(shop\)/,route);
    const auth=source.indexOf("await authenticate.webhook(request)");
    const scope=source.indexOf("assertPilotShop(shop)",auth);
    assert.ok(auth>=0 && scope>auth,route+" must verify HMAC first");
  }
});

test("effective Shopify session token grants cannot exceed product read access", () => {
  assert.doesNotThrow(() => assertPilotSessionScopes("read_products", pilot));
  for (const granted of [undefined, "", "write_content,read_products", "read_products,read_orders", "read_products,write_products"]) {
    assert.throws(() => assertPilotSessionScopes(granted,pilot),status(403));
  }
  assert.doesNotThrow(() => assertPilotSessionScopes("write_content",{}));
  const server=readFileSync(new URL("../app/shopify.server.ts",import.meta.url),"utf8");
  assert.match(server,/assertPilotSessionScopes\(context\.session\.scope\)/);
});
