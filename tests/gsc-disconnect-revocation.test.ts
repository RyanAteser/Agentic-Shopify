import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { encryptToken } from "../app/lib/gsc-crypto.server";
import { disconnectGoogle } from "../app/lib/gsc.server";
import { eraseMerchantData } from "../app/lib/merchant-redaction.server";

const makeShop = () => "gsc-revoke-" + randomUUID() + ".myshopify.com";

// PostgreSQL's MVCC read can see an old committed token while a re-consent
// transaction holds the merchant lock and is writing a new token. Disconnect
// must wait for that lock before selecting which credential to revoke.
test("PostgreSQL disconnect revokes the latest committed token after concurrent re-consent", {
  skip: !process.env.DATABASE_URL
}, async () => {
  const shop = makeShop();
  const previousKey = process.env.GSC_ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GSC_ENCRYPTION_KEY = Buffer.alloc(32, 83).toString("base64");
  const revoked: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/revoke");
    revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
    return Response.json({});
  };
  let signalLocked!: () => void;
  let releaseLock!: () => void;
  const locked = new Promise<void>(resolve => { signalLocked = resolve; });
  const gate = new Promise<void>(resolve => { releaseLock = resolve; });
  let blocker: Promise<unknown> | undefined;
  let disconnect: Promise<unknown> | undefined;
  try {
    await db.storeConfig.create({ data: { shop } });
    await db.searchConsoleConnection.create({ data: {
      shop, property: "https://example.test/",
      encryptedRefresh: encryptToken("obsolete-refresh")
    } });
    blocker = db.$transaction(async tx => {
      await tx.storeConfig.updateMany({
        where: { shop }, data: { updatedAt: new Date() }
      });
      await tx.searchConsoleConnection.update({
        where: { shop }, data: { encryptedRefresh: encryptToken("latest-refresh") }
      });
      signalLocked();
      await gate;
    }, { timeout: 10000 });
    await locked;
    disconnect = disconnectGoogle(shop);
    // Allow the old pre-lock read to occur before the re-consent commits.
    // The corrected implementation waits for the merchant lock instead.
    await new Promise(resolve => setTimeout(resolve, 150));
    releaseLock();
    await blocker;
    await disconnect;
    assert.deepEqual(revoked, ["latest-refresh"]);
    assert.equal(await db.searchConsoleConnection.count({ where: { shop } }), 0);
  } finally {
    releaseLock();
    await Promise.allSettled([blocker, disconnect].filter(Boolean) as Promise<unknown>[]);
    await eraseMerchantData(shop);
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY = previousKey;
  }
});

test("Google revocation HTTP errors are not treated as confirmed, but local data is erased", async () => {
  const shop = makeShop();
  const previousKey = process.env.GSC_ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  process.env.GSC_ENCRYPTION_KEY = Buffer.alloc(32, 89).toString("base64");
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  globalThis.fetch = async () => new Response("sensitive-upstream-body", { status: 503 });
  try {
    await db.storeConfig.create({ data: { shop } });
    await db.searchConsoleConnection.create({ data: {
      shop, property: "https://example.test/",
      encryptedRefresh: encryptToken("sensitive-refresh")
    } });
    await disconnectGoogle(shop);
    assert.equal(await db.searchConsoleConnection.count({ where: { shop } }), 0);
    assert.equal(await db.organicDailyMetric.count({ where: { shop } }), 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /revocation could not be confirmed/);
    assert.doesNotMatch(warnings[0], /sensitive-refresh|sensitive-upstream-body|example\.test/);
  } finally {
    await eraseMerchantData(shop);
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (previousKey === undefined) delete process.env.GSC_ENCRYPTION_KEY;
    else process.env.GSC_ENCRYPTION_KEY = previousKey;
  }
});
