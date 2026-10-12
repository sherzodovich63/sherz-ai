-- CreateEnum
CREATE TYPE "public"."ResponseLengthPref" AS ENUM ('short', 'medium', 'long', 'auto');

-- CreateEnum
CREATE TYPE "public"."TonePref" AS ENUM ('friendly', 'minimal_therapy', 'neutral');

-- CreateEnum
CREATE TYPE "public"."EnergyPref" AS ENUM ('calm', 'energetic', 'balanced');

-- CreateEnum
CREATE TYPE "public"."InboxStatus" AS ENUM ('PENDING', 'SENT', 'READ', 'ARCHIVED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "avatarUrl" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Fact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT,
    "time" TEXT,
    "rating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FactTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FactTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FactsOnTags" (
    "factId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "FactsOnTags_pkey" PRIMARY KEY ("factId","tagId")
);

-- CreateTable
CREATE TABLE "public"."FactEmbedding" (
    "factId" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactEmbedding_pkey" PRIMARY KEY ("factId")
);

-- CreateTable
CREATE TABLE "public"."HabitEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "json" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Todo" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Todo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Reminder" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firedAt" TIMESTAMP(3),

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MoodEntry" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "mood" TEXT NOT NULL,
    "note" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JournalEntry" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserProfile" (
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "preferredName" TEXT,
    "useNameRate" DOUBLE PRECISION NOT NULL DEFAULT 0.18,
    "lengthPref" "public"."ResponseLengthPref" NOT NULL DEFAULT 'auto',
    "tonePref" "public"."TonePref" NOT NULL DEFAULT 'friendly',
    "energyPref" "public"."EnergyPref" NOT NULL DEFAULT 'balanced',
    "askedNameAt" TIMESTAMP(3),
    "baselineTone" TEXT DEFAULT 'unknown',
    "baselineConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "baselineSampleSize" INTEGER NOT NULL DEFAULT 0,
    "toneState" TEXT NOT NULL DEFAULT 'warm',
    "toneStateSince" TIMESTAMP(3),
    "toneStateReason" TEXT,
    "calmTurnStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."ToneEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "messageRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToneEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActivitySignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ActivitySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmotionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emotion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmotionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BrainState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastSkill" TEXT,
    "lastArgs" JSONB,
    "lastResult" JSONB,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProfileSummaryCache" (
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "latestFactAt" TIMESTAMP(3),
    "latestEmotionLogAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileSummaryCache_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."ProactiveEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT,
    "shouldMessage" BOOLEAN NOT NULL,
    "reason" TEXT,
    "tone" TEXT,
    "message" TEXT,
    "sentAt" TIMESTAMP(3),
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "gotReply" BOOLEAN NOT NULL DEFAULT false,
    "replyAt" TIMESTAMP(3),
    "replyLatencyS" INTEGER,
    "hourLocal" INTEGER,
    "dayOfWeek" INTEGER,
    "awaitingReply" BOOLEAN NOT NULL DEFAULT false,
    "replyDeadlineAt" TIMESTAMP(3),
    "noReplyCause" TEXT,
    "noReplyConfidence" DOUBLE PRECISION,
    "boundaryDecision" TEXT,
    "permissionAsked" BOOLEAN NOT NULL DEFAULT false,
    "permissionResult" TEXT,
    "softPresenceSent" BOOLEAN NOT NULL DEFAULT false,
    "respectUntil" TIMESTAMP(3),
    "metaJson" JSONB,

    CONSTRAINT "ProactiveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserProactivePolicy" (
    "userId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxPerDay" INTEGER NOT NULL DEFAULT 4,
    "toneWeights" JSONB,
    "hourPenalty" JSONB,
    "blockedHours" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "proactiveMuteUntil" TIMESTAMP(3),
    "softPresenceCooldownHours" INTEGER NOT NULL DEFAULT 12,
    "respectCooldownHours" INTEGER NOT NULL DEFAULT 24,
    "permissionSensitivity" INTEGER NOT NULL DEFAULT 2,
    "lastSoftPresenceAt" TIMESTAMP(3),
    "respectModeUntil" TIMESTAMP(3),
    "busyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avoidingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overwhelmedScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "UserProactivePolicy_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."ProactiveInbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" "public"."InboxStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT,
    "meta" JSONB,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProactiveInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "public"."User"("googleId");

-- CreateIndex
CREATE INDEX "Message_userId_idx" ON "public"."Message"("userId");

-- CreateIndex
CREATE INDEX "Message_userId_createdAt_idx" ON "public"."Message"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Fact_userId_key_idx" ON "public"."Fact"("userId", "key");

-- CreateIndex
CREATE INDEX "Fact_updatedAt_idx" ON "public"."Fact"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactTag_name_key" ON "public"."FactTag"("name");

-- CreateIndex
CREATE INDEX "HabitEvent_userId_habitKey_idx" ON "public"."HabitEvent"("userId", "habitKey");

-- CreateIndex
CREATE INDEX "HabitEvent_userId_habitKey_firedAt_idx" ON "public"."HabitEvent"("userId", "habitKey", "firedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPref_userId_key_key" ON "public"."UserPref"("userId", "key");

-- CreateIndex
CREATE INDEX "Todo_userId_idx" ON "public"."Todo"("userId");

-- CreateIndex
CREATE INDEX "Todo_userId_done_idx" ON "public"."Todo"("userId", "done");

-- CreateIndex
CREATE INDEX "Reminder_userId_idx" ON "public"."Reminder"("userId");

-- CreateIndex
CREATE INDEX "Reminder_userId_status_idx" ON "public"."Reminder"("userId", "status");

-- CreateIndex
CREATE INDEX "Reminder_scheduledFor_idx" ON "public"."Reminder"("scheduledFor");

-- CreateIndex
CREATE INDEX "MoodEntry_userId_loggedAt_idx" ON "public"."MoodEntry"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_loggedAt_idx" ON "public"."JournalEntry"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "UserProfile_displayName_idx" ON "public"."UserProfile"("displayName");

-- CreateIndex
CREATE INDEX "UserProfile_preferredName_idx" ON "public"."UserProfile"("preferredName");

-- CreateIndex
CREATE INDEX "UserProfile_toneState_idx" ON "public"."UserProfile"("toneState");

-- CreateIndex
CREATE INDEX "ToneEvent_userId_createdAt_idx" ON "public"."ToneEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivitySignal_userId_occurredAt_idx" ON "public"."ActivitySignal"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivitySignal_userId_kind_occurredAt_idx" ON "public"."ActivitySignal"("userId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "EmotionLog_userId_idx" ON "public"."EmotionLog"("userId");

-- CreateIndex
CREATE INDEX "EmotionLog_userId_createdAt_idx" ON "public"."EmotionLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrainState_userId_key" ON "public"."BrainState"("userId");

-- CreateIndex
CREATE INDEX "BrainState_updatedAt_idx" ON "public"."BrainState"("updatedAt");

-- CreateIndex
CREATE INDEX "ProactiveEvent_userId_createdAt_idx" ON "public"."ProactiveEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProactiveEvent_userId_delivered_gotReply_idx" ON "public"."ProactiveEvent"("userId", "delivered", "gotReply");

-- CreateIndex
CREATE INDEX "ProactiveEvent_userId_awaitingReply_replyDeadlineAt_idx" ON "public"."ProactiveEvent"("userId", "awaitingReply", "replyDeadlineAt");

-- CreateIndex
CREATE INDEX "UserProactivePolicy_updatedAt_idx" ON "public"."UserProactivePolicy"("updatedAt");

-- CreateIndex
CREATE INDEX "ProactiveInbox_userId_status_createdAt_idx" ON "public"."ProactiveInbox"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProactiveInbox_userId_dedupeKey_idx" ON "public"."ProactiveInbox"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Fact" ADD CONSTRAINT "Fact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FactsOnTags" ADD CONSTRAINT "FactsOnTags_factId_fkey" FOREIGN KEY ("factId") REFERENCES "public"."Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FactsOnTags" ADD CONSTRAINT "FactsOnTags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "public"."FactTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FactEmbedding" ADD CONSTRAINT "FactEmbedding_factId_fkey" FOREIGN KEY ("factId") REFERENCES "public"."Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ToneEvent" ADD CONSTRAINT "ToneEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActivitySignal" ADD CONSTRAINT "ActivitySignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmotionLog" ADD CONSTRAINT "EmotionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BrainState" ADD CONSTRAINT "BrainState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
