CREATE TABLE "SwarmExecution" (
"id" TEXT NOT NULL,
"shop" TEXT NOT NULL,
"caseId" TEXT NOT NULL,
"status" TEXT NOT NULL DEFAULT 'reserved',
"provider" TEXT NOT NULL,
"model" TEXT NOT NULL,
"plan" TEXT NOT NULL,
"usageMonth" TEXT NOT NULL,
"maxCalls" INTEGER NOT NULL,
"callsStarted" INTEGER NOT NULL DEFAULT 0,
"callsFinished" INTEGER NOT NULL DEFAULT 0,
"inputTokens" INTEGER NOT NULL DEFAULT 0,
"outputTokens" INTEGER NOT NULL DEFAULT 0,
"leaseToken" TEXT,
"leaseExpiresAt" TIMESTAMP(3),
"errorCode" TEXT,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "SwarmExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SwarmExecution_caseId_key" ON "SwarmExecution"("caseId");
CREATE INDEX "SwarmExecution_shop_status_createdAt_idx" ON "SwarmExecution"("shop","status","createdAt");

CREATE TABLE "SwarmInvocation" (
"id" TEXT NOT NULL,
"shop" TEXT NOT NULL,
"executionId" TEXT NOT NULL,
"ordinal" INTEGER NOT NULL,
"agentId" TEXT NOT NULL,
"phase" TEXT NOT NULL,
"status" TEXT NOT NULL DEFAULT 'attempted',
"inputTokens" INTEGER NOT NULL DEFAULT 0,
"outputTokens" INTEGER NOT NULL DEFAULT 0,
"outputHash" TEXT,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "SwarmInvocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SwarmInvocation_executionId_ordinal_key" ON "SwarmInvocation"("executionId","ordinal");
CREATE INDEX "SwarmInvocation_shop_status_createdAt_idx" ON "SwarmInvocation"("shop","status","createdAt");

CREATE TABLE "SwarmUsageMonth" (
"shop" TEXT NOT NULL,
"month" TEXT NOT NULL,
"reserved" INTEGER NOT NULL DEFAULT 0,
"consumed" INTEGER NOT NULL DEFAULT 0,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "SwarmUsageMonth_pkey" PRIMARY KEY ("shop","month")
);
CREATE INDEX "SwarmUsageMonth_shop_month_idx" ON "SwarmUsageMonth"("shop","month");
