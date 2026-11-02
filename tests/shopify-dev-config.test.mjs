import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("Shopify CLI starts the app web frontend and backend", () => {
  const config = read("shopify.web.toml");
  assert.match(config, /^roles\s*=\s*\["frontend",\s*"backend"\]/m);
  assert.match(config, /^auth_callback_path\s*=\s*\["\/auth\/callback"\]/m);
  assert.match(config, /^dev\s*=\s*"npx react-router dev --host 0\.0\.0\.0"/m);
  assert.doesNotMatch(config, /^dev\s*=\s*"(?:npm run dev|shopify app dev)"/m);
});

test("Artemis preview updates only the selected dev-store URL", () => {
  const config = read("shopify.app.development.toml");
  assert.match(config, /^client_id\s*=\s*"[a-f0-9]{32}"/m);
  assert.match(config, /^embedded\s*=\s*true/m);
  assert.match(config, /^automatically_update_urls_on_dev\s*=\s*true/m);
  assert.match(config, /^scopes\s*=\s*"write_content,read_products"/m);
  assert.match(config, /^api_version\s*=\s*"2026-10"/m);
  assert.match(config, /^redirect_urls\s*=\s*\["https:\/\/example\.com\/auth\/callback"\]/m);
  assert.match(config, /uri = "\/webhooks\/app\/uninstalled"/);
  assert.match(config, /uri = "\/webhooks\/app\/scopes_update"/);
  assert.doesNotMatch(config, /ngrok-free\.app|trycloudflare\.com/);
});

test("embedded dashboard exposes Shopify App Bridge navigation and merchant-scoped overview", () => {
  const shell = read("app/routes/app.tsx");
  const home = read("app/routes/app._index.tsx");
  assert.match(shell, /import \{ NavMenu \} from "@shopify\/app-bridge-react"/);
  assert.match(shell, /<NavMenu>/);
  for (const path of ["/app", "/app/manager", "/app/team", "/app/seo", "/app/growth"]) {
    assert.ok(shell.includes(`href="${path}"`), `missing embedded nav link ${path}`);
  }
  assert.match(home, /heading="Store overview"/);
  assert.match(home, /drafts\.filter\(d => d\.status === "ready"/);
  assert.match(home, /FREE_LIFETIME_GENERATIONS - config\.freeDraftsUsed/);
  assert.match(home, /Nothing is published without your approval/);
});
