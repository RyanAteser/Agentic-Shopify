-- Existing queued jobs are intentionally NOT eligible for automatic replay.
-- Only new jobs explicitly marked outboxVersion=1 may be recovered.
ALTER TABLE "ContentJob" ADD COLUMN "outboxVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContentJob" ADD COLUMN "scheduleClaim" TEXT;

CREATE INDEX "ContentJob_outboxVersion_status_createdAt_idx"
  ON "ContentJob"("outboxVersion", "status", "createdAt");
