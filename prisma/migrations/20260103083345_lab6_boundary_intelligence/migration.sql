-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProactiveEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT,
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
    "dayOfWeek" INTEGER,
    "awaitingReply" BOOLEAN NOT NULL DEFAULT false,
    "replyDeadlineAt" DATETIME,
    "noReplyCause" TEXT,
    "noReplyConfidence" REAL,
    "boundaryDecision" TEXT,
    "permissionAsked" BOOLEAN NOT NULL DEFAULT false,
    "permissionResult" TEXT,
    "softPresenceSent" BOOLEAN NOT NULL DEFAULT false,
    "respectUntil" DATETIME,
    "metaJson" JSONB
);
INSERT INTO "new_ProactiveEvent" ("createdAt", "dayOfWeek", "delivered", "gotReply", "hourLocal", "id", "message", "reason", "replyAt", "replyLatencyS", "sentAt", "shouldMessage", "tone", "userId") SELECT "createdAt", "dayOfWeek", "delivered", "gotReply", "hourLocal", "id", "message", "reason", "replyAt", "replyLatencyS", "sentAt", "shouldMessage", "tone", "userId" FROM "ProactiveEvent";
DROP TABLE "ProactiveEvent";
ALTER TABLE "new_ProactiveEvent" RENAME TO "ProactiveEvent";
CREATE INDEX "ProactiveEvent_userId_createdAt_idx" ON "ProactiveEvent"("userId", "createdAt");
CREATE INDEX "ProactiveEvent_userId_delivered_gotReply_idx" ON "ProactiveEvent"("userId", "delivered", "gotReply");
CREATE INDEX "ProactiveEvent_userId_awaitingReply_replyDeadlineAt_idx" ON "ProactiveEvent"("userId", "awaitingReply", "replyDeadlineAt");
CREATE TABLE "new_UserProactivePolicy" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "updatedAt" DATETIME NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxPerDay" INTEGER NOT NULL DEFAULT 4,
    "toneWeights" JSONB,
    "hourPenalty" JSONB,
    "blockedHours" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "softPresenceCooldownHours" INTEGER NOT NULL DEFAULT 12,
    "respectCooldownHours" INTEGER NOT NULL DEFAULT 24,
    "permissionSensitivity" INTEGER NOT NULL DEFAULT 2,
    "lastSoftPresenceAt" DATETIME,
    "respectModeUntil" DATETIME,
    "busyScore" REAL NOT NULL DEFAULT 0,
    "avoidingScore" REAL NOT NULL DEFAULT 0,
    "overwhelmedScore" REAL NOT NULL DEFAULT 0
);
INSERT INTO "new_UserProactivePolicy" ("blockedHours", "cooldownMinutes", "hourPenalty", "maxPerDay", "toneWeights", "updatedAt", "userId") SELECT "blockedHours", "cooldownMinutes", "hourPenalty", "maxPerDay", "toneWeights", "updatedAt", "userId" FROM "UserProactivePolicy";
DROP TABLE "UserProactivePolicy";
ALTER TABLE "new_UserProactivePolicy" RENAME TO "UserProactivePolicy";
CREATE INDEX "UserProactivePolicy_updatedAt_idx" ON "UserProactivePolicy"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
