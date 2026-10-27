-- Explicit one-time merchant review outcomes; no buyer data or new Shopify scopes.
CREATE TABLE "EditorialReview" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reviewMinutes" INTEGER,
  "feedback" TEXT NOT NULL DEFAULT '',
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditorialReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EditorialReview_shop_draftId_key" ON "EditorialReview"("shop", "draftId");
CREATE INDEX "EditorialReview_shop_reviewedAt_idx" ON "EditorialReview"("shop", "reviewedAt");
