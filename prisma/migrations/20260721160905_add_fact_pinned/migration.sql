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
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Fact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Fact" ("createdAt", "id", "key", "rating", "time", "type", "updatedAt", "userId", "value") SELECT "createdAt", "id", "key", "rating", "time", "type", "updatedAt", "userId", "value" FROM "Fact";
DROP TABLE "Fact";
ALTER TABLE "new_Fact" RENAME TO "Fact";
CREATE INDEX "Fact_userId_key_idx" ON "Fact"("userId", "key");
CREATE INDEX "Fact_updatedAt_idx" ON "Fact"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
