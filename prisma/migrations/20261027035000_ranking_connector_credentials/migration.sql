-- Per-merchant connector keys. No backfill: old shared keys fail closed.
CREATE TABLE "RankingConnectorCredential" (
  "shop" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingConnectorCredential_pkey" PRIMARY KEY ("shop")
);
CREATE UNIQUE INDEX "RankingConnectorCredential_keyHash_key" ON "RankingConnectorCredential"("keyHash");
