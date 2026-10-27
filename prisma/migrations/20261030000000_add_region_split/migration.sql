-- Adds the region split of funds to SecurityClassification (story 8-4, owned by the classification module).
-- AlterTable
ALTER TABLE "SecurityClassification" ADD COLUMN "regionSplit" TEXT;
ALTER TABLE "SecurityClassification" ADD COLUMN "regionSplitSource" TEXT;
ALTER TABLE "SecurityClassification" ADD COLUMN "regionSplitAsOf" TEXT;
ALTER TABLE "SecurityClassification" ADD COLUMN "regionSplitIndex" TEXT;
ALTER TABLE "SecurityClassification" ADD COLUMN "regionSplitManual" TEXT;
