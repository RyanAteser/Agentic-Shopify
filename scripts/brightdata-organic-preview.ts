/**
 * Local, read-only preview of a parsed Bright Data Google SERP.
 * No network requests, Shopify mutations, connector secrets, or uploads.
 *
 * npx tsx scripts/brightdata-organic-preview.ts raw-serp.json context.json
 */
import { readFileSync } from "node:fs";
import { normalizeBrightDataOrganicGoogle, type BrightDataOrganicContext } from "../app/lib/brightdata-organic";

const [snapshotPath, contextPath, extra] = process.argv.slice(2);
if (!snapshotPath || !contextPath || extra) {
  throw new Error("Usage: npx tsx scripts/brightdata-organic-preview.ts raw-serp.json context.json");
}
function readJson(path: string, maxBytes: number): unknown {
  const bytes = readFileSync(path);
  if (bytes.byteLength > maxBytes) throw new Error("Preview input exceeds local size limit");
  return JSON.parse(bytes.toString("utf8"));
}
const context = readJson(contextPath, 4096) as BrightDataOrganicContext;
const snapshot = readJson(snapshotPath, 2_000_000);
const observations = normalizeBrightDataOrganicGoogle(snapshot, context);
process.stdout.write(JSON.stringify({observations}, null, 2) + "\n");
