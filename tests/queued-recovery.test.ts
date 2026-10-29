import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { createCreditedJob } from "../app/lib/credits.server";
import { claimQueuedDispatch, DispatchAlreadyClaimedError } from "../app/lib/dispatch-claim.server";
import { UncertainDispatchError } from "../app/lib/n8n-delivery.server";
import { recoverQueuedJobs } from "../app/lib/queued-recovery.server";
import { claimDueScheduledDraft } from "../app/lib/scheduled-drafts.server";

const now = new Date("2026-10-28T20:00:00.000Z");
const old = new Date("2026-10-28T19:45:00.000Z");
const due = new Date("2026-10-28T18:00:00.000Z");
async function withStore(run: (shop: string) => Promise<void>) {
  const shop = "outbox-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({ data: {
    shop, blogId: "gid://shopify/Blog/1", enabled: true,
    seedTopics: "Customer care guide", nextRunAt: due
  } });
  try { await run(shop); }
  finally {
    await db.contentJob.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
}
async function aged(jobId: string) {
  await db.contentJob.update({ where: { id: jobId }, data: { createdAt: old } });
}

test("durable manual outbox recovers an old queued job once, without consuming another credit", async () => {
  await withStore(async shop => {
    const job = await createCreditedJob(shop, "Helpful guide");
    assert.equal(job.outboxVersion, 1);
    await aged(job.id);
    let sends = 0;
    const dispatch = async (id: string, tenant: string) => {
      assert.equal(id, job.id); assert.equal(tenant, shop);
      await claimQueuedDispatch(tenant, id); sends++;
    };
    const result = await recoverQueuedJobs(now, dispatch);
    assert.equal(result.accepted, 1);
    assert.equal(sends, 1);
    assert.equal((await recoverQueuedJobs(now, dispatch)).candidates, 0);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: job.id } })).status, "running");
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1);
  });
});

test("never automatically replays running, uncertain, completed, legacy or fresh queued jobs", async () => {
  await withStore(async shop => {
    for (const [status, outboxVersion, createdAt] of [
      ["running", 1, old], ["dispatch_uncertain", 1, old],
      ["completed", 1, old], ["queued", 0, old],
      ["queued", 1, now]
    ] as const) {
      await db.contentJob.create({ data: {
        shop, topic: "Legacy or in-flight", status, outboxVersion, createdAt
      } });
    }
    let sends = 0;
    const result = await recoverQueuedJobs(now, async () => { sends++; });
    assert.equal(result.candidates, 0);
    assert.equal(sends, 0);
  });
});

test("scheduled queued recovery preserves atomic definitive rejection refund and slot rewind", async () => {
  await withStore(async shop => {
    const snapshot = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    const claim = await claimDueScheduledDraft(snapshot, now);
    assert.ok(claim);
    await aged(claim.jobId);
    const job = await db.contentJob.findUniqueOrThrow({ where: { id: claim.jobId } });
    assert.equal(job.outboxVersion, 1);
    assert.ok(job.scheduleClaim);
    const result = await recoverQueuedJobs(now, async (id, tenant) => {
      await claimQueuedDispatch(tenant, id);
      throw new Error("Definitive HTTP 400");
    });
    assert.equal(result.rejected, 1);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: claim.jobId } })).status, "failed");
    const after = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(after.freeDraftsUsed, 0);
    assert.equal(after.topicCursor, 0);
    assert.equal(after.nextRunAt?.toISOString(), due.toISOString());
  });
});

test("manual queued definitive rejection refunds once, never a second time", async () => {
  await withStore(async shop => {
    const job = await createCreditedJob(shop, "Merchant guide");
    await aged(job.id);
    const result = await recoverQueuedJobs(now, async (id, tenant) => {
      await claimQueuedDispatch(tenant, id);
      throw new Error("Definitive HTTP 404");
    });
    assert.equal(result.rejected, 1);
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 0);
    assert.equal((await recoverQueuedJobs(now, async () => { throw new Error("should not retry"); })).candidates, 0);
  });
});

test("uncertain n8n outcome retains credit and is never replayed", async () => {
  await withStore(async shop => {
    const job = await createCreditedJob(shop, "Merchant guide");
    await aged(job.id);
    const result = await recoverQueuedJobs(now, async (id, tenant) => {
      await claimQueuedDispatch(tenant, id);
      await db.contentJob.update({ where: { id }, data: { status: "dispatch_uncertain" } });
      throw new UncertainDispatchError();
    });
    assert.equal(result.uncertain, 1);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: job.id } })).status, "dispatch_uncertain");
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1);
    assert.equal((await recoverQueuedJobs(now)).candidates, 0);
  });
});

test("two recovery sweeps race safely: only one worker can claim a queued job", async () => {
  await withStore(async shop => {
    const job = await createCreditedJob(shop, "Merchant guide");
    await aged(job.id);
    let sends = 0;
    const dispatch = async (id: string, tenant: string) => {
      await claimQueuedDispatch(tenant, id); sends++;
    };
    const results = await Promise.all([
      recoverQueuedJobs(now, dispatch), recoverQueuedJobs(now, dispatch)
    ]);
    assert.equal(results.reduce((sum, x) => sum + x.accepted, 0), 1);
    assert.equal(sends, 1);
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1);
  });
});

test("callback that wins dispatch race cannot be failed or refunded", async () => {
  await withStore(async shop => {
    const job = await createCreditedJob(shop, "Merchant guide");
    await aged(job.id);
    const result = await recoverQueuedJobs(now, async (id) => {
      await db.contentJob.update({ where: { id }, data: { status: "completed" } });
      throw new DispatchAlreadyClaimedError();
    });
    assert.equal(result.raced, 1);
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: job.id } })).status, "completed");
    assert.equal((await db.storeConfig.findUniqueOrThrow({ where: { shop } })).freeDraftsUsed, 1);
  });
});

test("corrupt scheduled metadata blocks dispatch and preserves evidence for an operator", async () => {
  await withStore(async shop => {
    const job = await db.contentJob.create({ data: {
      shop, topic: "Merchant guide", outboxVersion: 1, scheduleClaim: "{bad-json", createdAt: old
    } });
    let sends = 0;
    const result = await recoverQueuedJobs(now, async () => { sends++; });
    assert.equal(result.blocked, 1);
    assert.equal(sends, 0);
    const quarantined = await db.contentJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(quarantined.status, "queued");
    assert.equal(quarantined.outboxVersion, 0, "malformed snapshot cannot starve later jobs");
    assert.match(quarantined.error ?? "", /quarantined/);
    assert.equal((await recoverQueuedJobs(now, async () => { sends++; })).candidates, 0);
  });
});

test("recovery respects the three-job batch bound and leaves remaining work queued", async () => {
  await withStore(async shop => {
    for (let i = 0; i < 5; i++) {
      await db.contentJob.create({ data: {
        shop, topic: "Batch " + i, outboxVersion: 1, createdAt: old
      } });
    }
    const result = await recoverQueuedJobs(now, async (id, tenant) => {
      await claimQueuedDispatch(tenant, id);
    });
    assert.equal(result.candidates, 3);
    assert.equal(result.accepted, 3);
    assert.equal(await db.contentJob.count({ where: { shop, status: "queued" } }), 2);
  });
});


test("recovery fairly selects one oldest queued job per merchant, not three from one backlog", async () => {
  const shops = Array.from({ length: 4 }, () =>
    "fair-outbox-" + randomUUID() + ".myshopify.com"
  );
  await db.storeConfig.createMany({ data: shops.map(shop => ({ shop })) });
  try {
    // A's five old jobs would occupy the entire original global top-three.
    // B, C and D must get a bounded opportunity even while A has a backlog.
    for (let i = 0; i < 5; i++) {
      await db.contentJob.create({ data: {
        shop: shops[0], topic: "A " + i, outboxVersion: 1,
        createdAt: new Date("2026-10-28T19:30:00.000Z")
      } });
    }
    for (let i = 1; i < shops.length; i++) {
      await db.contentJob.create({ data: {
        shop: shops[i], topic: "Other merchant", outboxVersion: 1,
        createdAt: new Date("2026-10-28T19:3" + i + ":00.000Z")
      } });
    }
    const first: string[] = [];
    const dispatch = async (id: string, shop: string) => {
      await claimQueuedDispatch(shop, id);
      first.push(shop);
    };
    const result = await recoverQueuedJobs(now, dispatch);
    assert.equal(result.candidates, 3);
    assert.equal(result.accepted, 3);
    assert.deepEqual(new Set(first), new Set(shops.slice(0, 3)));
    assert.equal(await db.contentJob.count({ where: { shop: shops[0], status: "queued" } }), 4);

    const second: string[] = [];
    const again = await recoverQueuedJobs(now, async (id, shop) => {
      await claimQueuedDispatch(shop, id);
      second.push(shop);
    });
    assert.equal(again.candidates, 2);
    assert.deepEqual(new Set(second), new Set([shops[0], shops[3]]));
    assert.equal(await db.contentJob.count({ where: { shop: shops[3], status: "queued" } }), 0);
  } finally {
    await db.contentJob.deleteMany({ where: { shop: { in: shops } } });
    await db.storeConfig.deleteMany({ where: { shop: { in: shops } } });
  }
});
