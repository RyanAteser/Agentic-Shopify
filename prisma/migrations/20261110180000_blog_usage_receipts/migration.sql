-- Worker-reported model usage is not invoice-verified provider billing.
CREATE TABLE "BlogGenerationUsage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai-chat-completions',
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "responseIdHash" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlogGenerationUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BlogGenerationUsage_shop_jobId_stage_key" ON "BlogGenerationUsage"("shop", "jobId", "stage");
CREATE INDEX "BlogGenerationUsage_shop_reportedAt_idx" ON "BlogGenerationUsage"("shop", "reportedAt");
