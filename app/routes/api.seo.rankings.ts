import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { assertRankingTargetsForPrimaryDomain, assertUniqueRankingObservations, parseRanking } from "../lib/seo";
import { primaryDomainForShop, saveRankingsForShop, reserveRankingImportBudget, RankingImportRateLimitError, RankingSnapshotConflictError } from "../lib/ranking-ingest.server";
import { authorizedRankingConnector } from "../lib/ranking-credentials.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
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
    assertUniqueRankingObservations(entries);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid data" }, { status: 400 });
  }

  // Bind the key to the payload shop before any Shopify Admin calls.
  const keyHash = await authorizedRankingConnector(shop, request.headers.get("X-Agent-Key"));
  if (!keyHash) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Reserve a durable per-shop budget before making any Shopify API call.
  // A failed or replayed request still costs admission capacity.
  try {
    await reserveRankingImportBudget(shop, keyHash, entries.length);
  } catch (e) {
    if (e instanceof RankingImportRateLimitError) {
      return Response.json({ error: "Ranking import quota exceeded" }, {
        status: 429, headers: { "Retry-After": String(e.retryAfterSeconds) }
      });
    }
    if (e instanceof Error && e.message === "Ranking connector revoked during import") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof Error && e.message === "Store disconnected during ranking import") {
      return Response.json({ error: "Store disconnected during ranking import" }, { status: 409 });
    }
    console.error("Ranking budget admission failed", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "Ranking budget unavailable; retry later" }, { status: 503 });
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
    await saveRankingsForShop(shop, entries, keyHash);
    return Response.json({ ok: true, records: entries.length, shop });
  } catch (e) {
    if (e instanceof RankingSnapshotConflictError) {
      // Do not retry this payload unchanged: it disagrees with stored evidence.
      return Response.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof Error && e.message === "Store disconnected during ranking import") {
      return Response.json({ error: "Store disconnected during ranking import" }, { status: 409 });
    }
    if (e instanceof Error && e.message === "Ranking connector revoked during import") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Ranking import failed", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "Ranking import failed; retry without changing the batch" }, { status: 503 });
  }
};
