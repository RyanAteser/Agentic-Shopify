import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateArticle, isArticleHtmlWithinBudget } from "../app/lib/content-quality.server";

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

test("link safety strips unsafe destinations without deleting article text", () => {
  const links = [
    'https://merchant.example/products/boots',
    'http://insecure.example/path',
    'https://user:pass@credential.example/path',
    'https://127.0.0.1/private',
    'https://[::1]/private',
    'https://localhost/private',
    'https://host.local/private',
    'https://merchant.example:8443/private',
    '//offsite.example/path',
    'javascript:alert(1)',
    'https://trusted.example\\\\@evil.example/path',
    '/products/boots',
  ];
  const body = shortBody + links.map((href, i) =>
    '<p><a href="' + href + '">Reference ' + i + '</a></p>').join("");
  const result = evaluateArticle({ ...base, body });
  const hrefs = [...result.article.body.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(hrefs, [
    "https://merchant.example/products/boots",
    "/products/boots",
  ]);
  assert.ok(result.article.body.includes("Reference 1"), "unsafe links retain visible text");
  assert.match(result.warnings.join(" "), /Removed 10 unsafe or malformed link destination/);
  assert.match(result.warnings.join(" "), /Verify 1 HTTPS link host/);
  assert.match(result.warnings.join(" "), /Verify 1 store-relative link/);
});

test("URL control characters cannot disguise an external navigation as a store-relative link", () => {
  // WHATWG URL parsing strips newlines/tabs before interpreting leading slashes.
  assert.equal(new URL("/\n/attacker.example", "https://storefront.invalid").hostname,
    "attacker.example");
  const links = [
    "/\n/attacker.example/collect",
    "/\t/attacker.example/collect",
    "/\r/attacker.example/collect",
    "https://legitimate.example/\npath",
  ];
  const html = shortBody + links.map((href, i) =>
    '<p><a href="' + href + '">Untrusted link ' + i + '</a></p>').join("") +
    '<p><a href="/&#10;/attacker.example/collect">Entity encoded newline</a></p>' +
    '<p><a href="/products/boots?variant=1">Legitimate storefront link</a></p>';
  const result = evaluateArticle({ ...base, body: html });
  assert.doesNotMatch(result.article.body, /href="https:\/\/attacker\.example/);
  assert.match(result.article.body, /href="\/products\/boots\?variant=1"/);
  assert.match(result.warnings.join(" "), /Removed 5 unsafe or malformed link destination/);
  for (let i = 0; i < 4; i++) {
    assert.match(result.article.body, new RegExp("<a>Untrusted link " + i + "</a>"),
      "Unsafe destination must lose its href, not just generate a warning");
  }
  assert.match(result.article.body, /<a>Entity encoded newline<\/a>/);
});

test("ordinary HTTPS references are preserved but never scored as verified citations", () => {
  const plain = evaluateArticle({ ...base, body: shortBody });
  const linked = evaluateArticle({
    ...base,
    body: shortBody + '<p><a href="https://research.example/study">Original research</a></p>'
  });
  assert.equal(linked.score, plain.score);
  assert.match(linked.article.body, /href="https:\/\/research.example\/study"/);
  assert.match(linked.warnings.join(" "), /sponsored or affiliate disclosure/);
});

test("merchant-supplied sponsored, ugc and nofollow qualifications survive sanitization", () => {
  const result = evaluateArticle({
    ...base,
    body: shortBody +
      '<p><a href="https://affiliate.example/item" rel="Sponsored nofollow sponsored">Affiliate</a></p>' +
      '<p><a href="/pages/community" rel="ugc,nofollow">Community</a></p>',
  });
  assert.match(result.article.body, /href="https:\/\/affiliate.example\/item" rel="sponsored nofollow"/);
  assert.match(result.article.body, /href="\/pages\/community" rel="ugc nofollow"/);
  assert.ok(result.score >= 70);
});

test("unsupported rel values and qualifications on unsafe destinations are removed", () => {
  const result = evaluateArticle({
    ...base,
    body: shortBody +
      '<p><a href="https://merchant.example/page" rel="sponsored canonical opener">Review</a></p>' +
      '<p><a href="http://unsafe.example" rel="sponsored">Insecure</a></p>' +
      '<p><a href="https://merchant.example/huge" rel="' + "sponsored ".repeat(40) + '">Huge</a></p>',
  });
  assert.match(result.article.body, /href="https:\/\/merchant.example\/page" rel="sponsored"/);
  assert.doesNotMatch(result.article.body, /canonical|opener|href="http:|rel="sponsored"[^>]*>Insecure/);
  assert.match(result.article.body, /<a>Insecure<\/a>/);
  assert.match(result.warnings.join(" "), /unsupported link rel token/);
});

test("HTML publication budget uses UTF-8 bytes, including multibyte characters", () => {
  assert.equal(isArticleHtmlWithinBudget("a".repeat(60_000)), true);
  assert.equal(isArticleHtmlWithinBudget("a".repeat(60_001)), false);
  assert.equal(isArticleHtmlWithinBudget("é".repeat(30_000)), true);
  assert.equal(isArticleHtmlWithinBudget("é".repeat(30_001)), false);
});

test("oversized AI HTML remains intact for correction but cannot become ready", () => {
  const body = "<h2>Choosing a product</h2><p>" + "é".repeat(31_000) + "</p>";
  const result = evaluateArticle({...base, body});
  assert.ok(Buffer.byteLength(result.article.body, "utf8") > 60_000);
  assert.ok(result.article.body.includes("é".repeat(100)), "never silently truncate claims");
  assert.ok(result.score < 70);
  assert.match(result.warnings.join(" "), /60 KB UTF-8 safety budget/);
});
