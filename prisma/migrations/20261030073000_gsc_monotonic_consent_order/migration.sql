-- Monotonic database ordering for Google Connect and Disconnect intent.
-- The single row is seeded before any new application worker uses the counter.
-- No shop identifier, OAuth token or consent history is stored here.
CREATE TABLE "GscConsentOrderCounter" (
    "id" INTEGER NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "GscConsentOrderCounter_pkey" PRIMARY KEY ("id")
);
INSERT INTO "GscConsentOrderCounter" ("id", "sequence") VALUES (1, 0);
ALTER TABLE "StoreConfig" ADD COLUMN "gscConsentRevokedOrder" BIGINT NOT NULL DEFAULT 0;
