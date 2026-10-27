-- Durable per-merchant ranking ingestion admission quotas, reset each UTC hour.
-- All existing shops start with zero use and no current window.
ALTER TABLE "StoreConfig"
  ADD COLUMN "rankingWindowStart" TIMESTAMP(3),
  ADD COLUMN "rankingRequestsUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rankingRecordsUsed" INTEGER NOT NULL DEFAULT 0;
