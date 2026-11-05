/**
 * Local-only SERP alert replay. Never calls Bright Data, Shopify, Google or n8n.
 * Usage: npx tsx scripts/seo-rank-replay.ts authorized-shop-export.json
 */
import { readFileSync } from "node:fs";
import { replayRankingAlerts } from "../app/lib/rank-replay";

const [path, extra] = process.argv.slice(2);
if (!path || extra) {
  throw new Error("Usage: npx tsx scripts/seo-rank-replay.ts authorized-shop-export.json");
}
const bytes = readFileSync(path);
if (bytes.byteLength > 2_000_000) throw new Error("Local replay export exceeds 2 MB");
const input: unknown = JSON.parse(bytes.toString("utf8"));
process.stdout.write(JSON.stringify(replayRankingAlerts(input), null, 2) + "\n");
