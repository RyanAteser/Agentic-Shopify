-- Persist an explicit Google consent revocation boundary for installed merchants.
-- A slow Connect request started before Disconnect must not create a fresh OAuth state.
ALTER TABLE "StoreConfig" ADD COLUMN "gscConsentRevokedAt" TIMESTAMP(3);
