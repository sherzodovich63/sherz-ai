-- CreateTable
CREATE TABLE "Reminder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firedAt" DATETIME
);

-- CreateTable
CREATE TABLE "MoodEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "mood" TEXT NOT NULL,
    "note" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "loggedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "loggedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Reminder_userId_idx" ON "Reminder"("userId");

-- CreateIndex
CREATE INDEX "Reminder_userId_status_idx" ON "Reminder"("userId", "status");

-- CreateIndex
CREATE INDEX "Reminder_scheduledFor_idx" ON "Reminder"("scheduledFor");

-- CreateIndex
CREATE INDEX "MoodEntry_userId_loggedAt_idx" ON "MoodEntry"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_loggedAt_idx" ON "JournalEntry"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "Todo_userId_idx" ON "Todo"("userId");

-- CreateIndex
CREATE INDEX "Todo_userId_done_idx" ON "Todo"("userId", "done");
