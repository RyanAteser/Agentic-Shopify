-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreConfig" (
    "shop" TEXT NOT NULL,
    "blogId" TEXT NOT NULL DEFAULT '',
    "authorName" TEXT NOT NULL DEFAULT 'Editorial Team',
    "audience" TEXT NOT NULL DEFAULT '',
    "brandVoice" TEXT NOT NULL DEFAULT '',
    "seedTopics" TEXT NOT NULL DEFAULT '',
    "cadenceDays" INTEGER NOT NULL DEFAULT 7,
    "topicCursor" INTEGER NOT NULL DEFAULT 0,
    "freeDraftsUsed" INTEGER NOT NULL DEFAULT 0,
    "lastManagerSyncAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreConfig_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "ContentJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleDraft" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "keyword" TEXT NOT NULL DEFAULT '',
    "seoScore" INTEGER NOT NULL DEFAULT 0,
    "reviewNotes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "shopifyArticleId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoRankObservation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'google',
    "country" TEXT NOT NULL DEFAULT 'US',
    "device" TEXT NOT NULL DEFAULT 'desktop',
    "position" INTEGER,
    "targetUrl" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'brightdata-serp',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoRankObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreRecommendation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "StoreRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreActivity" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "recommendationId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAuthState" (
    "stateHash" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleAuthState_pkey" PRIMARY KEY ("stateHash")
);

-- CreateTable
CREATE TABLE "SearchConsoleConnection" (
    "shop" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "encryptedRefresh" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "SearchConsoleConnection_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "OrganicDailyMetric" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "clicks" DOUBLE PRECISION NOT NULL,
    "impressions" DOUBLE PRECISION NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganicDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentJob_shop_status_idx" ON "ContentJob"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleDraft_jobId_key" ON "ArticleDraft"("jobId");

-- CreateIndex
CREATE INDEX "ArticleDraft_shop_status_idx" ON "ArticleDraft"("shop", "status");

-- CreateIndex
CREATE INDEX "SeoRankObservation_shop_observedAt_idx" ON "SeoRankObservation"("shop", "observedAt");

-- CreateIndex
CREATE INDEX "SeoRankObservation_shop_keyword_idx" ON "SeoRankObservation"("shop", "keyword");

-- CreateIndex
CREATE UNIQUE INDEX "SeoRankObservation_shop_keyword_engine_country_device_obser_key" ON "SeoRankObservation"("shop", "keyword", "engine", "country", "device", "observedAt");

-- CreateIndex
CREATE INDEX "StoreRecommendation_shop_status_priority_idx" ON "StoreRecommendation"("shop", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "StoreRecommendation_shop_sourceKey_key" ON "StoreRecommendation"("shop", "sourceKey");

-- CreateIndex
CREATE INDEX "StoreActivity_shop_createdAt_idx" ON "StoreActivity"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "GoogleAuthState_shop_expiresAt_idx" ON "GoogleAuthState"("shop", "expiresAt");

-- CreateIndex
CREATE INDEX "OrganicDailyMetric_shop_date_idx" ON "OrganicDailyMetric"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "OrganicDailyMetric_shop_property_date_key" ON "OrganicDailyMetric"("shop", "property", "date");
