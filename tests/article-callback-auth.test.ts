import { test } from "node:test";
import assert from "node:assert/strict";
import { createArticleCallbackToken, authorizedArticleCallback } from "../app/lib/article-callback-auth";

test("article callback capabilities bind the exact tenant and job without exposing the signing key", () => {
  const previous = process.env.ARTICLE_CALLBACK_SIGNING_KEY;
  process.env.ARTICLE_CALLBACK_SIGNING_KEY = Buffer.alloc(32, 41).toString("base64");
  try {
    const shop = "one.myshopify.com", job = "job-one";
    const token = createArticleCallbackToken(shop, job);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(authorizedArticleCallback(shop, job, token), true);
    assert.equal(authorizedArticleCallback("two.myshopify.com", job, token), false);
    assert.equal(authorizedArticleCallback(shop, "job-two", token), false);
    assert.equal(authorizedArticleCallback(shop, job, null), false);
    assert.equal(authorizedArticleCallback(shop, job, "shared-n8n-bridge-secret"), false);
    assert.equal(authorizedArticleCallback(shop, job, token.slice(0, -1)), false);
    assert.equal(authorizedArticleCallback(shop, job, token + "x"), false);
    assert.equal(authorizedArticleCallback(shop, job, token.replace(/./, "!")), false);
    assert.equal(createArticleCallbackToken(shop, job), token, "retry uses same scoped capability");
  } finally {
    if (previous === undefined) delete process.env.ARTICLE_CALLBACK_SIGNING_KEY;
    else process.env.ARTICLE_CALLBACK_SIGNING_KEY = previous;
  }
});

test("missing, malformed and noncanonical callback signing keys fail closed", () => {
  const previous = process.env.ARTICLE_CALLBACK_SIGNING_KEY;
  try {
    for (const bad of [undefined, "", "weak-secret", Buffer.alloc(16).toString("base64"),
      Buffer.alloc(32, 0).toString("base64").slice(0, -1) + "!"]) {
      if (bad === undefined) delete process.env.ARTICLE_CALLBACK_SIGNING_KEY;
      else process.env.ARTICLE_CALLBACK_SIGNING_KEY = bad;
      assert.throws(() => createArticleCallbackToken("a.myshopify.com", "j"), /ARTICLE_CALLBACK_SIGNING_KEY/);
      assert.equal(authorizedArticleCallback("a.myshopify.com", "j", "a".repeat(43)), false);
    }
  } finally {
    if (previous === undefined) delete process.env.ARTICLE_CALLBACK_SIGNING_KEY;
    else process.env.ARTICLE_CALLBACK_SIGNING_KEY = previous;
  }
});
