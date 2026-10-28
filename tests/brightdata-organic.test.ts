import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBrightDataOrganicGoogle } from "../app/lib/brightdata-organic";

const now = new Date("2026-10-28T12:00:00.000Z");
const context = {keyword: "Leather boots", country: "US", device: "desktop" as const,
  observedAt: "2026-10-28T11:55:00.000Z", primaryHost: "shop.example"};
const sample = {
  general: {search_engine: "google", query: "Leather boots", device: "desktop", gl: "us"},
  organic: [
    {rank: 1, global_rank: 4, link: "https://competitor.example/boots"},
    {rank: 3, global_rank: 9, link: "https://shop.example/products/boots"},
    {rank: 5, global_rank: 12, link: "https://shop.example/blog/boots"}
  ],
  paid: [{rank: 1, link: "https://shop.example/ads"}]
};

test("uses the first merchant organic rank, never global rank or paid placements", () => {
  const rows = normalizeBrightDataOrganicGoogle(sample, context, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].position, 3);
  assert.equal(rows[0].targetUrl, "https://shop.example/products/boots");
  assert.equal(rows[0].source, "brightdata-serp");
});

test("unmatched and empty organic samples abstain instead of claiming not found", () => {
  assert.deepEqual(normalizeBrightDataOrganicGoogle({...sample, organic: [sample.organic[0]]}, context, now), []);
  assert.deepEqual(normalizeBrightDataOrganicGoogle({...sample, organic: []}, context, now), []);
});

test("context mismatches and missing organic evidence fail closed", () => {
  for (const invalid of [
    {...sample, general: {...sample.general, query: "different query"}},
    {...sample, general: {...sample.general, device: "mobile"}},
    {...sample, general: {...sample.general, search_engine: "bing"}},
    {...sample, general: {...sample.general, gl: "ca"}},
    {...sample, general: null},
    {...sample, organic: undefined},
    {...sample, organic: [{global_rank: 3, link: "https://shop.example/boots"}]},
    {...sample, organic: [{rank: 2, link: null}]},
    {...sample, organic: [{rank: 2, link: "javascript:alert(1)"}]},
    {...sample, organic: [{rank: 2, link: "https://shop.example/a"}, {rank: 2, link: "https://shop.example/b"}]},
  ]) assert.throws(() => normalizeBrightDataOrganicGoogle(invalid, context, now), /Bright Data|organic/i);
});

test("exact primary host and HTTPS required, with no subdomain or paid fallthrough", () => {
  const other = {...sample, organic: [
    {rank: 1, link: "https://shop.example.attacker.test/boots"},
    {rank: 2, link: "https://blog.shop.example/boots"},
    {rank: 3, link: "http://shop.example/boots"}
  ]};
  assert.deepEqual(normalizeBrightDataOrganicGoogle(other, context, now), []);
  assert.throws(() => normalizeBrightDataOrganicGoogle(sample, {...context, primaryHost: "https://shop.example"}, now));
});

test("timestamp and market fields still pass the canonical ranking validator", () => {
  assert.throws(() => normalizeBrightDataOrganicGoogle(sample, {...context, observedAt: "tomorrow"}, now));
  assert.throws(() => normalizeBrightDataOrganicGoogle(sample, {...context, country: "ZZZ"}, now));
  assert.throws(() => normalizeBrightDataOrganicGoogle(sample, {...context, observedAt: "2026-10-28T12:10:00Z"}, now));
});
