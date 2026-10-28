import { test } from "node:test";
import assert from "node:assert/strict";
import { toSafeShopifySummaryHtml } from "../app/lib/article-summary";

test("Shopify HTML summary preserves ordinary merchant copy", () => {
  assert.equal(toSafeShopifySummaryHtml("Plain merchant excerpt. Café 🛍️"),
    "Plain merchant excerpt. Café 🛍️");
});

test("Shopify HTML summary escapes markup and attribute delimiters", () => {
  assert.equal(toSafeShopifySummaryHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(toSafeShopifySummaryHtml("A & B < C > D; it's \"good\""),
    "A &amp; B &lt; C &gt; D; it&#39;s &quot;good&quot;");
});

test("already encoded entity remains literal, not executable markup", () => {
  assert.equal(toSafeShopifySummaryHtml("&lt;script&gt;"),
    "&amp;lt;script&amp;gt;");
});
