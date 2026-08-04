-- CreateTable
CREATE TABLE "ProactiveEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shouldMessage" BOOLEAN NOT NULL,
    "reason" TEXT,
    "tone" TEXT,
    "message" TEXT,
    "sentAt" DATETIME,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "gotReply" BOOLEAN NOT NULL DEFAULT false,
    "replyAt" DATETIME,
    "replyLatencyS" INTEGER,
    "hourLocal" INTEGER,
    "dayOfWeek" INTEGER
);

-- CreateTable
CREATE TABLE "UserProactivePolicy" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "updatedAt" DATETIME NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxPerDay" INTEGER NOT NULL DEFAULT 4,
    "toneWeights" JSONB,
    "hourPenalty" JSONB,
    "blockedHours" JSONB
);

-- CreateIndex
CREATE INDEX "ProactiveEvent_userId_createdAt_idx" ON "ProactiveEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProactiveEvent_userId_delivered_gotReply_idx" ON "ProactiveEvent"("userId", "delivered", "gotReply");

-- CreateIndex
CREATE INDEX "UserProactivePolicy_updatedAt_idx" ON "UserProactivePolicy"("updatedAt");
