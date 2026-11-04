import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readOnlyPilotEnabled, assertPilotConfiguration,
  assertPilotRequest, assertPilotShop
} from "../app/lib/pilot-readonly";

const pilot = {
  AGENTIC_PILOT_MODE: "read_only",
  AGENTIC_PILOT_SHOP: "monika-test.myshopify.com",
  SCOPES: "read_products",
};
const req = (path: string, method = "GET") =>
  ({ method, url: "https://pilot.example" + path });
const status = (code: number) => (error: unknown) =>
  error instanceof Response && error.status === code;

test("pilot activation requires exact read-only scope and a canonical shop", () => {
  assert.equal(readOnlyPilotEnabled(pilot), true);
  assert.doesNotThrow(() => assertPilotConfiguration(pilot));
  assert.throws(() => assertPilotConfiguration({...pilot, SCOPES:"read_products,write_content"}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, SCOPES:""}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, AGENTIC_PILOT_SHOP:"example.com"}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, AGENTIC_PILOT_SHOP:undefined}), status(503));
  assert.throws(() => assertPilotConfiguration({...pilot, AGENTIC_PILOT_MODE:"unsafe"}), status(503));
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
