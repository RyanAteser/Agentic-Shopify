import * as crypto from "node:crypto";
import db from "../db.server";

// 256-bit bearer key; only its SHA-256 digest is persisted.
export function newRankingConnectorKey(): string {
  return "rank_" + crypto.randomBytes(32).toString("base64url");
}
export function rankingKeyHash(raw: string | null): string | null {
  if (!raw || !/^rank_[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}
// No global-key fallback; the credential must belong to this exact shop.
export async function authorizedRankingConnector(shop: string, raw: string | null): Promise<string | null> {
  const keyHash = rankingKeyHash(raw);
  if (!keyHash) return null;
  const match = await db.rankingConnectorCredential.findFirst({
    where: { shop, keyHash }, select: { shop: true }
  });
  return match ? keyHash : null;
}
// Trusted operator provisioning only. Lock the same row as ranking import.
export async function rotateRankingConnectorKey(shop: string): Promise<string> {
  const raw = newRankingConnectorKey();
  const keyHash = rankingKeyHash(raw)!;
  await db.$transaction(async tx => {
    const active = await tx.storeConfig.updateMany({
      where: { shop }, data: { updatedAt: new Date() }
    });
    if (active.count !== 1) throw new Error("Store not connected");
    await tx.rankingConnectorCredential.upsert({
      where: { shop }, create: { shop, keyHash },
      update: { keyHash, rotatedAt: new Date() }
    });
  });
  return raw;
}
export async function revokeRankingConnectorKey(shop: string): Promise<void> {
  await db.$transaction(async tx => {
    const active = await tx.storeConfig.updateMany({
      where: { shop }, data: { updatedAt: new Date() }
    });
    if (active.count !== 1) throw new Error("Store not connected");
    await tx.rankingConnectorCredential.deleteMany({ where: { shop } });
  });
}
