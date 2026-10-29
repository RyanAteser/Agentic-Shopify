/**
 * Offline-only Search Console corroboration for a Google SERP incident.
 * Usage: npx tsx scripts/gsc-rank-evidence.ts consented-gsc-export.json
 * Never calls Google, Shopify, Bright Data or n8n.
 */
import {readFileSync} from "node:fs";
import {assessGscRankEvidence} from "../app/lib/gsc-rank-evidence";

const [path,extra]=process.argv.slice(2);
if(!path||extra)throw new Error("Usage: npx tsx scripts/gsc-rank-evidence.ts consented-gsc-export.json");
const bytes=readFileSync(path);
if(bytes.byteLength>2000000)throw new Error("Offline GSC export exceeds 2 MB");
const raw:unknown=JSON.parse(bytes.toString("utf8"));
process.stdout.write(JSON.stringify(assessGscRankEvidence(raw),null,2)+"\n");
