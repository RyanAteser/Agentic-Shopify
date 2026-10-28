import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import {
  claimDueScheduledDraft, failScheduledDraft, findDueScheduledDrafts
} from "../app/lib/scheduled-drafts.server";

const now = new Date("2026-10-28T17:00:00.000Z");
const due = new Date("2026-10-28T16:00:00.000Z");
const shopId = () => "schedule-" + randomUUID() + ".myshopify.com";

async function withStore(
  data: Record<string, unknown>,
  run: (shop: string) => Promise<void>
) {
  const shop = shopId();
  await db.storeConfig.create({ data: { shop, blogId: "gid://shopify/Blog/1",
    enabled: true, seedTopics: "First topic,Second topic", nextRunAt: due, ...data } });
  try { await run(shop); }
  finally {
    await db.contentJob.deleteMany({ where: { shop } });
    await db.storeConfig.deleteMany({ where: { shop } });
  }
}

test("one due claim atomically creates a job, consumes a credit and advances topic", async () => {
  await withStore({ cadenceDays: 3 }, async shop => {
    const before = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    const claimed = await claimDueScheduledDraft(before, now);
    assert.ok(claimed);
    assert.equal(claimed.topic, "First topic");
    const after = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(after.freeDraftsUsed, 1);
    assert.equal(after.topicCursor, 1);
    assert.equal(after.nextRunAt?.toISOString(), "2026-10-31T17:00:00.000Z");
    assert.equal((await db.contentJob.findMany({ where: { shop } })).length, 1);
    assert.equal(await claimDueScheduledDraft(before, now), null,
      "stale scheduler read cannot duplicate a reserved job");
    assert.equal((await db.contentJob.findMany({ where: { shop } })).length, 1);
  });
});

test("definitive rejection refunds and restores due slot exactly once", async () => {
  await withStore({ topicCursor: 1 }, async shop => {
    const snapshot = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    const claim = await claimDueScheduledDraft(snapshot, now);
    assert.ok(claim);
    assert.equal(claim.topic, "Second topic");
    assert.equal(await failScheduledDraft(claim, "n8n definitive HTTP 400"), true);
    assert.equal(await failScheduledDraft(claim, "duplicate"), false);
    const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(config.freeDraftsUsed, 0);
    assert.equal(config.topicCursor, 1);
    assert.equal(config.nextRunAt?.toISOString(), due.toISOString());
    const job = await db.contentJob.findUniqueOrThrow({ where: { id: claim.jobId } });
    assert.equal(job.status, "failed");
    const replacement = await claimDueScheduledDraft(config, now);
    assert.ok(replacement);
    assert.equal(replacement.topic, "Second topic");
    assert.notEqual(replacement.jobId, claim.jobId);
  });
});

test("uncertain delivery cannot be refunded or requeued", async () => {
  await withStore({}, async shop => {
    const snapshot = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    const claim = await claimDueScheduledDraft(snapshot, now);
    assert.ok(claim);
    await db.contentJob.update({
      where: { id: claim.jobId }, data: { status: "dispatch_uncertain" }
    });
    assert.equal(await failScheduledDraft(claim, "unconfirmed transport"), false);
    const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(config.freeDraftsUsed, 1);
    assert.equal(config.topicCursor, 1);
    assert.equal(config.nextRunAt?.toISOString(), claim.nextRunAt.toISOString());
    assert.equal(await claimDueScheduledDraft(snapshot, now), null);
  });
});

test("merchant changes are never overwritten by a late definitive failure", async () => {
  await withStore({}, async shop => {
    const snapshot = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    const claim = await claimDueScheduledDraft(snapshot, now);
    assert.ok(claim);
    const merchantDate = new Date("2026-11-15T00:00:00.000Z");
    await db.storeConfig.update({
      where: { shop }, data: { seedTopics: "New merchant plan", nextRunAt: merchantDate }
    });
    assert.equal(await failScheduledDraft(claim, "n8n HTTP 400"), true);
    const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(config.freeDraftsUsed, 0);
    assert.equal(config.topicCursor, 1, "do not roll back cursor after merchant edit");
    assert.equal(config.seedTopics, "New merchant plan");
    assert.equal(config.nextRunAt?.toISOString(), merchantDate.toISOString());
  });
});

test("exhausted, disabled and not-yet-due plans cannot reserve or starve others", async () => {
  await withStore({ freeDraftsUsed: 3 }, async exhausted => {
    await withStore({ enabled: false }, async disabled => {
      await withStore({ nextRunAt: new Date("2026-10-30T00:00:00Z") }, async future => {
        await withStore({}, async eligible => {
          const rows = await findDueScheduledDrafts(now);
          assert.ok(rows.some(x => x.shop === eligible));
          for (const shop of [exhausted, disabled, future]) {
            assert.equal(rows.some(x => x.shop === shop), false);
            const snapshot = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
            assert.equal(await claimDueScheduledDraft(snapshot, now), null);
            assert.equal(await db.contentJob.count({ where: { shop } }), 0);
          }
        });
      });
    });
  });
});

test("PostgreSQL concurrent claims create at most one due job", {
  skip: !process.env.DATABASE_URL
}, async () => {
  await withStore({}, async shop => {
    const snapshot = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => claimDueScheduledDraft(snapshot, now))
    );
    assert.equal(attempts.filter(x => x.status === "rejected").length, 0);
    assert.equal(attempts.filter(x => x.status === "fulfilled" && x.value !== null).length, 1);
    assert.equal(await db.contentJob.count({ where: { shop } }), 1);
    const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    assert.equal(config.freeDraftsUsed, 1);
    assert.equal(config.topicCursor, 1);
  });
});

test("PostgreSQL callback-style completion cannot be undone by a late refund", {
  skip: !process.env.DATABASE_URL
}, async () => {
  await withStore({}, async shop => {
    const snapshot = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    const claim = await claimDueScheduledDraft(snapshot, now);
    assert.ok(claim);
    await db.contentJob.update({ where: { id: claim.jobId }, data: { status: "running" } });
    const results = await Promise.allSettled([
      failScheduledDraft(claim, "definitive reject"),
      (async () => {
        // Simulate a callback's transaction lock ordering and conditional status.
        return db.$transaction(async tx => {
          await tx.storeConfig.updateMany({
            where: { shop }, data: { updatedAt: new Date() }
          });
          return tx.contentJob.updateMany({
            where: { id: claim.jobId, shop, status: "running" },
            data: { status: "completed" }
          });
        });
      })()
    ]);
    assert.ok(results.every(x => x.status === "fulfilled"), "no deadlock");
    const job = await db.contentJob.findUniqueOrThrow({ where: { id: claim.jobId } });
    const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
    if (job.status === "failed") {
      assert.equal(config.freeDraftsUsed, 0);
      assert.equal(config.nextRunAt?.toISOString(), due.toISOString());
    } else {
      assert.equal(job.status, "completed");
      assert.equal(config.freeDraftsUsed, 1);
      assert.equal(config.nextRunAt?.toISOString(), claim.nextRunAt.toISOString());
    }
  });
});
