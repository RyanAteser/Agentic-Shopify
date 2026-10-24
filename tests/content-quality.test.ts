import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateArticle } from "../app/lib/content-quality.server";

const longBody = '<h2>How to choose</h2><p>' + "Useful practical advice ".repeat(155) +
  '</p><h2>Common pitfalls</h2><p>' + "Check the details carefully ".repeat(95) + '</p>';

test("useful article qualifies for merchant review without requiring fabricated citations", () => {
  const result = evaluateArticle({
    title: "Choosing the right product for your needs",
    summary: "A practical approach to selecting products, avoiding common mistakes and making the most informed decision.",
    body: longBody, keyword: "product", tags: ["Guide"],
  });
  assert.ok(result.score >= 70);
  assert.ok(result.words >= 450);
  assert.equal(result.article.tags[0], "Guide");
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
    title: "Choosing the right product for your needs",
    summary: "A practical approach to selecting products, avoiding common mistakes and making an informed decision.",
    body: longBody + "<p>Lorem ipsum</p>", keyword: "product", tags: [],
  });
  assert.ok(result.score <= 40);
});

test("article body size guard prevents oversized payloads", () => {
  assert.throws(() => evaluateArticle({
    title: "Oversize", summary: "sample", body: "x".repeat(100_001), keyword: "test",
  }));
});
