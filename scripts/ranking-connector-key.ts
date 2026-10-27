import db from "../app/db.server";
import { rotateRankingConnectorKey, revokeRankingConnectorKey } from "../app/lib/ranking-credentials.server";

// Operator-only. Never provision from a public endpoint or merchant UI.
const [operation, shop, confirmation] = process.argv.slice(2);
if (!["rotate", "revoke"].includes(operation ?? "") ||
    !/^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$/.test(shop ?? "") ||
    confirmation !== "--confirm=" + shop) {
  process.stderr.write("Usage: npx tsx scripts/ranking-connector-key.ts <rotate|revoke> <shop.myshopify.com> --confirm=<shop.myshopify.com>\\n");
  process.exit(2);
}
try {
  if (operation === "rotate") {
    const secret = await rotateRankingConnectorKey(shop);
    process.stdout.write("One-time connector key (copy directly into a secret manager):\\n" + secret + "\\n");
  } else {
    await revokeRankingConnectorKey(shop);
    process.stdout.write("Ranking connector revoked for " + shop + "\\n");
  }
} catch (error) {
  process.stderr.write("Ranking credential operation failed: " + (error instanceof Error ? error.message : "unknown") + "\\n");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
