import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeArticlePreviewHtml } from "../app/lib/content-quality.server";

test("legacy scripts, event handlers and dangerous links are stripped before admin preview", () => {
  const stored = '<h2>Guide</h2><script>alert(1)</script>' +
    '<p><img src=x onerror="alert(2)"><a href="javascript:alert(3)">Read more</a></p>' +
    '<p><a href="/&#10;/attacker.example/collect">Disguised link</a></p>';
  const snapshot = stored;
  const preview = safeArticlePreviewHtml(stored);
  assert.equal(preview.changed, true);
  assert.equal(preview.unavailable, false);
  assert.doesNotMatch(preview.html, /<script|<img|onerror|javascript:|href="\/\/attacker/i);
  assert.match(preview.html, /Read more/);
  assert.match(preview.html, /Disguised link/);
  assert.equal(stored, snapshot, "preview must not rewrite approved or stored HTML");
});

test("canonical HTML remains readable with legitimate sponsored links", () => {
  const stored = '<h2>Guide</h2><p><a href="/products/boots" rel="sponsored">Boots</a></p>';
  const preview = safeArticlePreviewHtml(stored);
  assert.deepEqual(preview, { html: stored, changed: false, unavailable: false });
});

test("oversized legacy HTML fails closed instead of entering an HTML sink", () => {
  const preview = safeArticlePreviewHtml("<script>alert(1)</script>" + "x".repeat(100_001));
  assert.deepEqual(preview, { html: "", changed: true, unavailable: true });
});

test("both merchant admin preview routes use sanitized output, not raw stored bodies", () => {
  const blog = readFileSync("app/routes/app._index.tsx", "utf8");
  const manager = readFileSync("app/routes/app.manager.tsx", "utf8");
  for (const route of [blog, manager]) {
    assert.match(route, /safeArticlePreviewHtml/);
    assert.match(route, /dangerouslySetInnerHTML=\{\{__html:previewMap\.get\(/);
    assert.doesNotMatch(route, /dangerouslySetInnerHTML=\{\{__html:(?:d|article)\.body\}\}/);
  }
});
