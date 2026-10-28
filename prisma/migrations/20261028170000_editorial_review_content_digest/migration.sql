-- Legacy approvals have no digest and must be renewed before publication.
-- This migration changes only app-owned review metadata, not merchant content.
ALTER TABLE "EditorialReview"
  ADD COLUMN "contentDigest" TEXT NOT NULL DEFAULT '';
