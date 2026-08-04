-- CreateTable
CREATE TABLE "BrainState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "lastSkill" TEXT,
    "lastArgs" JSONB,
    "lastResult" JSONB,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrainState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BrainState_userId_key" ON "BrainState"("userId");

-- CreateIndex
CREATE INDEX "BrainState_updatedAt_idx" ON "BrainState"("updatedAt");
