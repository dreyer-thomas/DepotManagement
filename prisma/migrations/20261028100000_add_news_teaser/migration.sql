-- Adds NewsArticle.teaser and the YAHOO_RSS news provider (story 3-8, owned by the news module).
-- The provider enum is stored as TEXT in SQLite; the new value needs no schema change.
-- AlterTable
ALTER TABLE "NewsArticle" ADD COLUMN "teaser" TEXT;
