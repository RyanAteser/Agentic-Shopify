import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateArticle } from "../app/lib/content-quality.server";

const longBody = '<h2>How to choose</h2><p>' + "Useful practical advice ".repeat(155) +
  '</p><h2>Common pitfalls</h2><p>' + "Check the details carefully ".repeat(95) + '</p>';
const shortBody = '<h2>Practical fit</h2><p>Choose the product that fits your actual needs. Compare its materials, sizing, and care instructions with your daily use. Ask the merchant to confirm any claims that are not listed on the product page.</p>';
const base = {
  title: "Choosing the right product for your needs",
  summary: "A practical approach to selecting products, avoiding common mistakes and making the most informed decision.",
  keyword: "product",
  tags: ["Guide"],
};

test("substantive article qualifies for human review without fabricated citations", () => {
  const result = evaluateArticle({ ...base, body: longBody });
  assert.ok(result.score >= 70);
  assert.ok(result.words >= 450);
  assert.equal(result.article.tags[0], "Guide");
});

test("short, useful copy is not penalized for missing an arbitrary 450-word target", () => {
  const result = evaluateArticle({ ...base, body: shortBody });
  assert.ok(result.words < 450);
  assert.ok(result.score >= 70);
  assert.equal(result.warnings.some(w => /thin|450 words/i.test(w)), false);
});

test("unverified external links do not inflate editorial readiness", () => {
  const withoutLinks = evaluateArticle({ ...base, body: shortBody });
  const withLinks = evaluateArticle({
    ...base,
    body: shortBody.replace("</p>", ' <a href="https://example.org/unverified">Read more</a><a href="https://another.example/claim">More</a></p>'),
  });
  assert.equal(withLinks.score, withoutLinks.score);
  assert.match(withLinks.warnings.join(" "), /links are unverified/i);
});

test("empty or heading-only copy cannot pass the human-review readiness gate", () => {
  const result = evaluateArticle({ ...base, body: "<h2>Product selection guide</h2>" });
  assert.ok(result.score <= 40);
  assert.match(result.warnings.join(" "), /empty-draft safeguard/i);
});

test("HTML scripts and unsafe link schemes never reach the preview", () => {
  const result = evaluateArticle({
    title: "Safe article",
    summary: "Summary",
    body: '<script>alert(1)</script><p><a href="javascript:alert(1)">Click</a></p>',
    keyword: "article", tags: [],
  });
  assert.equal(result.article.body.includes("<script"), false);
  assert.equal(result.article.body.includes("javascript:"), false);
});

test("placeholder articles are blocked by the structural gate", () => {
  const result = evaluateArticle({
    ...base,
    body: longBody + "<p>Lorem ipsum</p>",
  });
  assert.ok(result.score <= 40);
});

test("article body size guard prevents oversized payloads", () => {
  assert.throws(() => evaluateArticle({
    title: "Oversize", summary: "sample", body: "x".repeat(100_001), keyword: "test",
  }));
});
