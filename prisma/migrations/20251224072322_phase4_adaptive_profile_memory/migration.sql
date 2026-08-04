-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT,
    "preferredName" TEXT,
    "useNameRate" REAL NOT NULL DEFAULT 0.18,
    "lengthPref" TEXT NOT NULL DEFAULT 'auto',
    "tonePref" TEXT NOT NULL DEFAULT 'friendly',
    "energyPref" TEXT NOT NULL DEFAULT 'balanced',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmotionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "emotion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmotionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserProfile_displayName_idx" ON "UserProfile"("displayName");

-- CreateIndex
CREATE INDEX "UserProfile_preferredName_idx" ON "UserProfile"("preferredName");

-- CreateIndex
CREATE INDEX "EmotionLog_userId_idx" ON "EmotionLog"("userId");

-- CreateIndex
CREATE INDEX "EmotionLog_userId_createdAt_idx" ON "EmotionLog"("userId", "createdAt");
