-- AlterTable
ALTER TABLE "Fact" ADD COLUMN "rating" INTEGER;
ALTER TABLE "Fact" ADD COLUMN "time" TEXT;
ALTER TABLE "Fact" ADD COLUMN "type" TEXT;

-- CreateIndex
CREATE INDEX "Fact_userId_key_idx" ON "Fact"("userId", "key");
