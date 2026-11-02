import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("embedded app shell exposes the real Shopify workspace navigation", () => {
  const shell = read("app/routes/app.tsx");
  assert.match(shell, /<AppProvider apiKey=\{apiKey\}>/);
  assert.match(shell, /<NavMenu>[\s\S]*?<\/NavMenu>/);
  for (const route of ["/app", "/app/manager", "/app/team", "/app/seo", "/app/growth"]) {
    assert.ok(shell.includes(`href="${route}"`), `Missing Shopify navigation link: ${route}`);
  }
  assert.match(shell, /<Outlet\s*\/>/);
});

test("merchant homepage shows factual, computed overview rather than placeholders", () => {
  const home = read("app/routes/app._index.tsx");
  assert.match(home, /<s-section heading="Store overview">/);
  assert.match(home, /const draftsAwaitingReview = drafts\.filter/);
  assert.match(home, /const remainingGenerations = Math\.max\(0, FREE_LIFETIME_GENERATIONS - config\.freeDraftsUsed\)/);
  assert.match(home, /\{shop\}/);
  assert.match(home, /Nothing is published without your approval/);
});

test("public onboarding describes real features instead of scaffold placeholders", () => {
  const landing = read("app/routes/_index/route.tsx");
  assert.doesNotMatch(landing, /Product feature|Some detail about your feature/);
  assert.match(landing, /Blog Agent/);
  assert.match(landing, /Store Manager/);
  assert.match(landing, /Verified Growth/);
});
