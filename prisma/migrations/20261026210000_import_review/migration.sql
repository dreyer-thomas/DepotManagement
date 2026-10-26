-- Adds review decisions and the readable document date to ImportItem (story 5-3, owned by the import module).
-- AlterTable
ALTER TABLE "ImportItem" ADD COLUMN "decisions" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ImportItem" ADD COLUMN "documentDate" TEXT;
