-- Adds the analyst ratings (story 9-7, owned by the classification module): the Analysten-Symbol per
-- Security on SecurityClassification and the analyst part of the disposable key-figures snapshot.
-- AlterTable
ALTER TABLE "SecurityClassification" ADD COLUMN "analystSymbol" TEXT;
ALTER TABLE "SecurityClassification" ADD COLUMN "analystSymbolManual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SecurityKeyFigures" ADD COLUMN "analystSymbol" TEXT;
ALTER TABLE "SecurityKeyFigures" ADD COLUMN "analysts" TEXT;
