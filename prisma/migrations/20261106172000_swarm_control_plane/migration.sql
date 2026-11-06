-- Per-shop named agent slots, research cases, and immutable agent dialogue.
-- Never run this migration on the isolated read-only pilot without a release review.
CREATE TABLE "SwarmAgent" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SwarmAgent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SwarmAgent_shop_role_kind_status_idx" ON "SwarmAgent"("shop", "role", "kind", "status");
CREATE INDEX "SwarmAgent_shop_status_idx" ON "SwarmAgent"("shop", "status");

CREATE TABLE "SwarmCase" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "hypothesis" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "rejectionRule" TEXT NOT NULL,
  "participantsJson" TEXT NOT NULL DEFAULT '[]',
  "reviewRound" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SwarmCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SwarmCase_shop_status_createdAt_idx" ON "SwarmCase"("shop", "status", "createdAt");
CREATE INDEX "SwarmCase_shop_role_createdAt_idx" ON "SwarmCase"("shop", "role", "createdAt");

CREATE TABLE "SwarmMessage" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT,
  "kind" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "evidenceJson" TEXT NOT NULL DEFAULT '[]',
  "falsifier" TEXT,
  "verdict" TEXT,
  "reviewRound" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SwarmMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SwarmMessage_shop_caseId_createdAt_idx" ON "SwarmMessage"("shop", "caseId", "createdAt");
CREATE INDEX "SwarmMessage_shop_senderId_idx" ON "SwarmMessage"("shop", "senderId");
