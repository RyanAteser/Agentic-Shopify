-- Explicitly merchant-scoped read-only Search Console page/date aggregates.
-- No authorization tokens or buyer/customer data stored in this table.
ALTER TABLE "SearchConsoleConnection"
  ADD COLUMN "lastPageSyncedAt" TIMESTAMP(3),
  ADD COLUMN "lastPageSyncStartedAt" TIMESTAMP(3);

CREATE TABLE "GscProductDailyMetric" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "clicks" DOUBLE PRECISION NOT NULL,
    "impressions" DOUBLE PRECISION NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GscProductDailyMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GscProductDailyMetric_shop_property_pageUrl_date_key"
  ON "GscProductDailyMetric"("shop","property","pageUrl","date");
CREATE INDEX "GscProductDailyMetric_shop_property_date_idx"
  ON "GscProductDailyMetric"("shop","property","date");
