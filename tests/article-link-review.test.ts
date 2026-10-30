import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeDraftLinks } from "../app/lib/article-link-review";

test("review inventory groups duplicate safe links and preserves decoded destinations", () => {
  const result = summarizeDraftLinks(
    '<p><a href="/products/boots?variant=1&amp;ref=guide">Boots</a>' +
    '<a href="https://research.example/study">Research</a>' +
    '<a href="/products/boots?variant=1&amp;ref=guide">More boots</a></p>'
  );
  assert.equal(result.previewUnavailable, false);
  assert.equal(result.uniqueTotal, 2);
  assert.equal(result.occurrences, 3);
  assert.deepEqual(result.links, [
    { href: "/products/boots?variant=1&ref=guide", kind: "store-relative", host: null, occurrences: 2, emptyAnchorText: 0, genericAnchorText: 0 },
    { href: "https://research.example/study", kind: "absolute-https", host: "research.example", occurrences: 1, emptyAnchorText: 0, genericAnchorText: 0 },
  ]);
});

test("unsafe and stripped links never enter the review inventory", () => {
  const result = summarizeDraftLinks(
    '<p><a href="javascript:alert(1)">Bad</a>' +
    '<a href="http://unsafe.example/">Insecure</a>' +
    '<a href="/&#10;/attacker.example">Encoded newline</a>' +
    '<a href="https://valid.example/source">Valid</a></p>'
  );
  assert.equal(result.uniqueTotal, 1);
  assert.equal(result.occurrences, 1);
  assert.equal(result.links[0].href, "https://valid.example/source");
  assert.equal(result.previewChanged, true);
  assert.ok(result.links.every(link => !/attacker|unsafe|javascript/.test(link.href)));
});

test("long articles have an explicit bounded inventory, not false complete coverage", () => {
  const body = "<p>" + Array.from({ length: 26 }, (_, i) =>
    '<a href="/pages/guide-' + i + '">Guide</a>').join("") + "</p>";
  const result = summarizeDraftLinks(body);
  assert.equal(result.uniqueTotal, 26);
  assert.equal(result.occurrences, 26);
  assert.equal(result.links.length, 20);
  assert.equal(result.truncated, true);
  assert.equal(summarizeDraftLinks(body, 50).truncated, false);
});

test("unavailable legacy previews never expose unsanitized links", () => {
  const result = summarizeDraftLinks('<p><a href="https://example.com">Test</a></p>' + "x".repeat(100_001));
  assert.equal(result.previewUnavailable, true);
  assert.deepEqual(result.links, []);
  assert.equal(result.uniqueTotal, 0);
});

test("review display limit is explicitly bounded", () => {
  assert.throws(() => summarizeDraftLinks("<p>ok</p>", 100), /Invalid link review display limit/);
  assert.throws(() => summarizeDraftLinks("<p>ok</p>", 0), /Invalid link review display limit/);
});

test("flags only high-confidence generic and empty link text without blocking drafts", () => {
  const result = summarizeDraftLinks(
    '<p><a href="/products/boots"><strong>Read more</strong></a>' +
    '<a href="/products/boots">Winter boots size guide</a>' +
    '<a href="https://research.example/study"></a>' +
    '<a href="https://research.example/study" title="Full methodology"></a></p>'
  );
  assert.equal(result.uniqueTotal, 2);
  assert.equal(result.occurrences, 4);
  assert.equal(result.emptyAnchorOccurrences, 1);
  assert.equal(result.genericAnchorOccurrences, 1);
  assert.equal(result.links[0].genericAnchorText, 1);
  assert.equal(result.links[0].emptyAnchorText, 0);
  assert.equal(result.links[1].emptyAnchorText, 1);
  assert.equal(result.links[1].genericAnchorText, 0);
});

test("does not count stripped unsafe anchors as SEO review warnings", () => {
  const result = summarizeDraftLinks(
    '<p><a href="javascript:alert(1)">Click here</a>' +
    '<a href="https://example.org/guide"><em>How to fit winter boots</em></a></p>'
  );
  assert.equal(result.occurrences, 1);
  assert.equal(result.genericAnchorOccurrences, 0);
  assert.equal(result.emptyAnchorOccurrences, 0);
});

test("counts anchor warnings across truncated inventory without claiming full display", () => {
  const body = "<p>" + Array.from({length: 25}, (_, i) =>
    '<a href="/pages/guide-' + i + '">Here</a>').join("") + "</p>";
  const result = summarizeDraftLinks(body, 20);
  assert.equal(result.truncated, true);
  assert.equal(result.links.length, 20);
  assert.equal(result.genericAnchorOccurrences, 25);
  assert.equal(result.emptyAnchorOccurrences, 0);
});
