/*
  Warnings:

  - You are about to drop the column `email` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `googleId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "UserProactivePolicy" ADD COLUMN "proactiveMuteUntil" DATETIME;

-- CreateTable
CREATE TABLE "ToneEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "messageRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToneEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivitySignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "ActivitySignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT
);
INSERT INTO "new_User" ("createdAt", "id", "name") SELECT "createdAt", "id", "name" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE TABLE "new_UserProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT,
    "preferredName" TEXT,
    "useNameRate" REAL NOT NULL DEFAULT 0.18,
    "lengthPref" TEXT NOT NULL DEFAULT 'auto',
    "tonePref" TEXT NOT NULL DEFAULT 'friendly',
    "energyPref" TEXT NOT NULL DEFAULT 'balanced',
    "askedNameAt" DATETIME,
    "baselineTone" TEXT DEFAULT 'unknown',
    "baselineConfidence" REAL NOT NULL DEFAULT 0.0,
    "baselineSampleSize" INTEGER NOT NULL DEFAULT 0,
    "toneState" TEXT NOT NULL DEFAULT 'warm',
    "toneStateSince" DATETIME,
    "toneStateReason" TEXT,
    "calmTurnStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserProfile" ("askedNameAt", "createdAt", "displayName", "energyPref", "lengthPref", "preferredName", "tonePref", "updatedAt", "useNameRate", "userId") SELECT "askedNameAt", "createdAt", "displayName", "energyPref", "lengthPref", "preferredName", "tonePref", "updatedAt", "useNameRate", "userId" FROM "UserProfile";
DROP TABLE "UserProfile";
ALTER TABLE "new_UserProfile" RENAME TO "UserProfile";
CREATE INDEX "UserProfile_displayName_idx" ON "UserProfile"("displayName");
CREATE INDEX "UserProfile_preferredName_idx" ON "UserProfile"("preferredName");
CREATE INDEX "UserProfile_toneState_idx" ON "UserProfile"("toneState");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ToneEvent_userId_createdAt_idx" ON "ToneEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivitySignal_userId_occurredAt_idx" ON "ActivitySignal"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivitySignal_userId_kind_occurredAt_idx" ON "ActivitySignal"("userId", "kind", "occurredAt");
