-- CreateIndex
CREATE INDEX "Fact_updatedAt_idx" ON "Fact"("updatedAt");

-- CreateIndex
CREATE INDEX "HabitEvent_userId_habitKey_firedAt_idx" ON "HabitEvent"("userId", "habitKey", "firedAt");
