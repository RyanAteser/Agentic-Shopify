-- Prospective capped exposure, not a statement of actual vendor invoices.
CREATE TABLE "BlogBudgetPolicy" (
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyCapCents" INTEGER NOT NULL,
    "perJobReserveCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlogBudgetPolicy_pkey" PRIMARY KEY ("shop")
);
CREATE TABLE "BlogBudgetMonth" (
    "shop" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "committedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlogBudgetMonth_pkey" PRIMARY KEY ("shop","month")
);
CREATE TABLE "BlogBudgetClaim" (
    "jobId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "reservedCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlogBudgetClaim_pkey" PRIMARY KEY ("jobId")
);
CREATE INDEX "BlogBudgetClaim_shop_month_idx" ON "BlogBudgetClaim"("shop", "month");
