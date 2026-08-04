-- CreateTable
CREATE TABLE "ProactiveInbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT,
    "meta" JSONB,
    "scheduledFor" DATETIME,
    "sentAt" DATETIME,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ProactiveInbox_userId_status_createdAt_idx" ON "ProactiveInbox"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProactiveInbox_userId_dedupeKey_idx" ON "ProactiveInbox"("userId", "dedupeKey");
