-- CreateTable
CREATE TABLE "ProfileSummaryCache" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "summary" TEXT NOT NULL,
    "latestFactAt" DATETIME,
    "latestEmotionLogAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
