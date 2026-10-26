-- Adds NewsArticle and NewsFetch (story 3-7, owned by the news module).
-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fetchedAt" TEXT NOT NULL,
    CONSTRAINT "NewsArticle_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsFetch" (
    "securityId" TEXT NOT NULL PRIMARY KEY,
    "fetchedAt" TEXT NOT NULL,
    CONSTRAINT "NewsFetch_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_securityId_url_key" ON "NewsArticle"("securityId", "url");
