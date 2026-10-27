import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../app/lib/request-body.server";

function streamedRequest(chunks: Uint8Array[], headers?: HeadersInit) {
  let index = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const request = new Request("https://example.test/callback", {
    method: "POST", body, headers, duplex: "half"
  } as RequestInit & { duplex: "half" });
  return { request, wasCancelled: () => cancelled };
}

test("bounded reader accepts the exact byte limit across streaming chunks", async () => {
  const bytes = new TextEncoder().encode("A😀"); // five UTF-8 bytes, two JS characters
  const { request } = streamedRequest([bytes.slice(0, 2), bytes.slice(2)]);
  assert.equal(await readBoundedRequestText(request, 5), "A😀");
});

test("bounded reader rejects oversized chunked bodies even without Content-Length", async () => {
  const stream = streamedRequest([new TextEncoder().encode("123"), new TextEncoder().encode("456")]);
  await assert.rejects(readBoundedRequestText(stream.request, 5), RequestBodyTooLargeError);
  assert.equal(stream.wasCancelled(), true, "rejecting an oversized request must cancel its stream");
});

test("bounded reader does not trust a smaller Content-Length or UTF-16 string length", async () => {
  const stream = streamedRequest([new TextEncoder().encode("😀")], { "content-length": "1" });
  await assert.rejects(readBoundedRequestText(stream.request, 3), RequestBodyTooLargeError);
});

test("declared oversized bodies fail before stream consumption", async () => {
  const stream = streamedRequest([new TextEncoder().encode("ok")], { "content-length": "1000" });
  await assert.rejects(readBoundedRequestText(stream.request, 5), RequestBodyTooLargeError);
});

test("both external JSON ingestion routes enforce a streamed byte limit", () => {
  const callback = readFileSync("app/routes/api.agent.complete.ts", "utf8");
  const rankings = readFileSync("app/routes/api.seo.rankings.ts", "utf8");
  assert.match(callback, /readBoundedRequestText\\(request, 150_000\\)/);
  assert.match(rankings, /readBoundedRequestText\\(request, 75_000\\)/);
  for (const route of [callback, rankings]) {
    assert.doesNotMatch(route, /await request\\.text\\(\\)/);
    assert.match(route, /instanceof RequestBodyTooLargeError/);
  }
});
