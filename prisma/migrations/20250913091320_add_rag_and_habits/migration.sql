-- CreateTable
CREATE TABLE "FactTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "FactsOnTags" (
    "factId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("factId", "tagId"),
    CONSTRAINT "FactsOnTags_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactsOnTags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "FactTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FactEmbedding" (
    "factId" TEXT NOT NULL PRIMARY KEY,
    "vector" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FactEmbedding_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HabitEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "habitKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "firedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserPref" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "json" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Fact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT,
    "time" TEXT,
    "rating" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Fact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Fact" ("createdAt", "id", "key", "rating", "time", "type", "updatedAt", "userId", "value") SELECT "createdAt", "id", "key", "rating", "time", "type", "updatedAt", "userId", "value" FROM "Fact";
DROP TABLE "Fact";
ALTER TABLE "new_Fact" RENAME TO "Fact";
CREATE INDEX "Fact_userId_key_idx" ON "Fact"("userId", "key");
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("createdAt", "id", "role", "text", "userId") SELECT "createdAt", "id", "role", "text", "userId" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_userId_idx" ON "Message"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "FactTag_name_key" ON "FactTag"("name");

-- CreateIndex
CREATE INDEX "HabitEvent_userId_habitKey_idx" ON "HabitEvent"("userId", "habitKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserPref_userId_key_key" ON "UserPref"("userId", "key");
