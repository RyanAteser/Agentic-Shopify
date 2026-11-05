import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import db from "../app/db.server";
import { createCreditedJob, failCreditedJob } from "../app/lib/credits.server";
import { claimQueuedDispatch } from "../app/lib/dispatch-claim.server";
import { deliverClaimedN8nJob, UncertainDispatchError } from "../app/lib/n8n-delivery.server";
import { persistArticleCallback } from "../app/lib/article-callback.server";

const article = {
  title: "How to choose the right product for your needs",
  summary: "Practical guidance for evaluating a product's fit, care instructions, and suitability before making a purchase decision.",
  keyword: "product",
  tags: ["Guide"],
  body: "<h2>Choosing well</h2><p>Compare the product's material, fit, care instructions and intended use with your own requirements. Check the product listing and contact the merchant if a claim is unclear. Make sure the product actually addresses your needs before purchasing.</p>"
};

async function withJob(fn: (shop: string, jobId: string) => Promise<void>) {
  const shop = "delivery-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({ data: { shop, blogId: "gid://shopify/Blog/1" } });
  try {
    const job = await createCreditedJob(shop, "Test generation");
    await claimQueuedDispatch(shop, job.id);
    await fn(shop, job.id);
  } finally {
    await db.editorialReview.deleteMany({ where: { shop } });
    await db.articleDraft.deleteMany({ where: { shop } });
    await db.contentJob.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
}

async function withHttpStub(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  fn: (url: string) => Promise<void>
) {
  const server = createServer((req, res) => {
    void Promise.resolve().then(() => handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing stub port");
  try {
    await fn("http://127.0.0.1:" + address.port + "/webhook/blog");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  }
}

function deliver(shop: string, jobId: string, url: string) {
  return deliverClaimedN8nJob({
    shop, jobId, url, secret: "test-only-outbound-secret",
    body: { jobId, shop, topic: "Test generation" }
  });
}

test("202 acknowledgment is not completion and sends exactly one authenticated POST", async () => {
  await withJob(async (shop, jobId) => {
    let received = 0;
    await withHttpStub(async (req, res) => {
      received++;
      assert.equal(req.method, "POST");
      assert.equal(req.headers["x-agent-key"], "test-only-outbound-secret");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
        jobId, shop, topic: "Test generation"
      });
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: true, jobId, shop }));
    }, async url => {
      await deliver(shop, jobId, url);
    });
    assert.equal(received, 1);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status, "running");
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1);
  });
});

test("2xx without a matching job-scoped 202 acknowledgment is uncertain, never refundable or replayed", async () => {
  const modes = [
    "default-200", "no-content-204", "empty-202", "bad-json", "wrong-job",
    "wrong-shop", "negative-ack", "oversized", "wrong-content-type"
  ] as const;
  for (const mode of modes) {
    await withJob(async (shop, jobId) => {
      let received = 0;
      await withHttpStub((_req, res) => {
        received++;
        if (mode === "default-200") { res.writeHead(200); res.end("Workflow got started"); return; }
        if (mode === "no-content-204") { res.writeHead(204); res.end(); return; }
        const body = mode === "empty-202" ? "" :
          mode === "bad-json" ? "{" :
          mode === "oversized" ? JSON.stringify({ accepted: true, jobId, shop, padding: "x".repeat(3000) }) :
          JSON.stringify({
            accepted: mode !== "negative-ack",
            jobId: mode === "wrong-job" ? "another-job" : jobId,
            shop: mode === "wrong-shop" ? "another.myshopify.com" : shop
          });
        res.writeHead(202, { "Content-Type": mode === "wrong-content-type" ? "text/plain" : "application/json" });
        res.end(body);
      }, async url => {
        await assert.rejects(deliver(shop, jobId, url), UncertainDispatchError, mode);
      });
      assert.equal(received, 1, mode);
      assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status,
        "dispatch_uncertain", mode);
      assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed,
        1, mode);
      assert.equal(await failCreditedJob(shop, jobId, "incorrect acceptance"), false, mode);
    });
  }
});

test("callback winning before malformed 202 acknowledgment cannot be overwritten", async () => {
  await withJob(async (shop, jobId) => {
    await withHttpStub(async (_req, res) => {
      await persistArticleCallback(shop, jobId, article);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: true, jobId: "other-job", shop }));
    }, async url => {
      await assert.rejects(deliver(shop, jobId, url), UncertainDispatchError);
    });
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status, "completed");
    assert.equal(await db.articleDraft.count({ where: { jobId } }), 1);
    assert.equal(await failCreditedJob(shop, jobId, "late refund"), false);
  });
});

test("4xx responses after POST remain uncertain and cannot silently refund or replay", async () => {
  // A proxy or a workflow may emit 4xx after accepting the request. An HTTP
  // code without a durable job-specific rejection receipt is not proof of no work.
  for (const status of [400, 401, 403, 404, 405, 410, 413, 415, 422]) {
    await withJob(async (shop, jobId) => {
      let received = 0;
      await withHttpStub((_req, res) => {
        received++;
        res.writeHead(status);
        res.end();
      }, async url => {
        await assert.rejects(deliver(shop, jobId, url), UncertainDispatchError);
      });
      assert.equal(received, 1, "no automatic retry after " + status);
      assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status,
        "dispatch_uncertain", String(status));
      assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed,
        1, String(status));
      assert.equal(await failCreditedJob(shop, jobId, "misclassified HTTP " + status), false);
      if (status === 400) {
        // A callback can arrive after a misleading HTTP error. It must still
        // complete exactly once and preserve the original reserved credit.
        const saved = await persistArticleCallback(shop, jobId, article);
        assert.deepEqual(await persistArticleCallback(shop, jobId, article), saved);
        assert.equal(await db.articleDraft.count({ where: { jobId } }), 1);
        assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status,
          "completed");
      }
    });
  }
});

test("429 response is uncertain, retains credit, and accepts a later idempotent callback", async () => {
  await withJob(async (shop, jobId) => {
    await withHttpStub((_req, res) => {
      res.writeHead(429);
      res.end();
    }, async url => {
      await assert.rejects(deliver(shop, jobId, url), UncertainDispatchError);
    });
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status, "dispatch_uncertain");
    assert.equal(await failCreditedJob(shop, jobId, "retry"), false);
    const first = await persistArticleCallback(shop, jobId, article);
    const replay = await persistArticleCallback(shop, jobId, article);
    assert.deepEqual(replay, first);
    assert.equal(await db.articleDraft.count({ where: { jobId } }), 1);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status, "completed");
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1);
  });
});

test("callback completing before a 503 response cannot be reverted to uncertain", async () => {
  await withJob(async (shop, jobId) => {
    await withHttpStub(async (_req, res) => {
      await persistArticleCallback(shop, jobId, article);
      res.writeHead(503);
      res.end();
    }, async url => {
      await assert.rejects(deliver(shop, jobId, url), UncertainDispatchError);
    });
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status, "completed");
    assert.equal(await db.articleDraft.count({ where: { jobId } }), 1);
    assert.equal(await failCreditedJob(shop, jobId, "late refund"), false);
  });
});

test("redirect and dropped response never trigger an authenticated second request or refund", async () => {
  for (const mode of ["redirect", "drop"] as const) {
    await withJob(async (shop, jobId) => {
      let requests = 0;
      await withHttpStub((req, res) => {
        requests++;
        if (mode === "redirect") {
          res.writeHead(302, { Location: "/unexpected-second-request" });
          res.end();
        } else {
          req.socket.destroy();
        }
      }, async url => {
        await assert.rejects(deliver(shop, jobId, url), UncertainDispatchError);
      });
      assert.equal(requests, 1, "never follow redirects or retry failed transport");
      assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status, "dispatch_uncertain");
      assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1);
      assert.equal(await failCreditedJob(shop, jobId, "ambiguous transport"), false);
    });
  }
});

test("ambiguous HTTP outcome remains non-refundable even when the status write fails", async () => {
  // A failed status update used to leak a generic database error to callers.
  // Those callers refund generic errors, despite n8n possibly accepting work.
  for (const mode of ["503", "dropped"] as const) {
    await withJob(async (shop, jobId) => {
      let requests = 0;
      let recordAttempts = 0;
      await withHttpStub((req, res) => {
        requests++;
        if (mode === "dropped") req.socket.destroy();
        else { res.writeHead(503); res.end(); }
      }, async url => {
        let caught: unknown;
        try {
          await deliverClaimedN8nJob({
            shop, jobId, url, secret: "test-only-outbound-secret",
            body: { shop, jobId, topic: "Test generation" }
          }, async () => {
            recordAttempts++;
            throw new Error("simulated database outage while marking uncertain");
          });
        } catch (error) {
          caught = error;
          // Mirror both manual and scheduled dispatch caller policies.
          if (!(error instanceof UncertainDispatchError)) {
            await failCreditedJob(shop, jobId, error);
          }
        }
        assert.ok(caught instanceof UncertainDispatchError,
          "Persistence failure must not become a generic refundable error");
      });
      assert.equal(requests, 1, "No automatic retry");
      assert.equal(recordAttempts, 1);
      assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status,
        "running", "The simulated failed write must not falsely persist a status");
      assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed,
        1, "Never refund a potentially accepted paid generation");
    });
  }
});
