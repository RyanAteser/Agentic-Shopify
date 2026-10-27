import * as crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { assertRankingTargetsForPrimaryDomain, parseRanking } from "../lib/seo";
import { primaryDomainForShop, saveRankingsForShop } from "../lib/ranking-ingest.server";

function authenticated(request: Request) {
  const expected = process.env.N8N_RANKING_SECRET;
  const actual = request.headers.get("X-Agent-Key");
  if (!expected || !actual) return false;
  const digest = (x: string) => crypto.createHash("sha256").update(x).digest();
  return crypto.timingSafeEqual(digest(expected), digest(actual));
}
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!authenticated(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length") || "0") > 75_000) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  let shop: string;
  let entries: ReturnType<typeof parseRanking>[];
  try {
    const text = await request.text();
    if (text.length > 75_000) return Response.json({ error: "Payload too large" }, { status: 413 });
    const value = JSON.parse(text);
    shop = String(value.shop || "");
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      return Response.json({ error: "Invalid Shopify tenant" }, { status: 400 });
    }
    if (!Array.isArray(value.observations) || !value.observations.length || value.observations.length > 50) {
      return Response.json({ error: "Expect 1-50 ranking records" }, { status: 400 });
    }
    const now = new Date();
    entries = value.observations.map((item: unknown) => parseRanking(item, now));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid data" }, { status: 400 });
  }

  if (!await db.storeConfig.findUnique({ where: { shop }, select: { shop: true } })) {
    return Response.json({ error: "Store not connected" }, { status: 404 });
  }

  // Fail closed when Shopify cannot attest the primary domain. Never trust
  // the tenant's self-reported domain in an n8n webhook payload.
  let primaryHost: string;
  try {
    const { admin, session } = await unauthenticated.admin(shop);
    if (session.shop !== shop) throw new Error("Wrong Shopify session");
    primaryHost = await primaryDomainForShop(admin, shop);
  } catch {
    return Response.json({ error: "Shopify storefront verification unavailable; retry later" }, { status: 503 });
  }
  try {
    assertRankingTargetsForPrimaryDomain(entries, primaryHost);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid ranking domain" }, { status: 400 });
  }
  try {
    await saveRankingsForShop(shop, entries);
    return Response.json({ ok: true, records: entries.length, shop });
  } catch (e) {
    if (e instanceof Error && e.message === "Store disconnected during ranking import") {
      return Response.json({ error: "Store disconnected during ranking import" }, { status: 409 });
    }
    console.error("Ranking import failed", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "Ranking import failed; retry without changing the batch" }, { status: 503 });
  }
};
