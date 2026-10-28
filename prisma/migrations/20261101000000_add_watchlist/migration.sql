-- Adds Watchlist and WatchlistEntry (story 9-1, owned by the watchlist module).
-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "WatchlistEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "dateAdded" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'APP',
    "clientName" TEXT,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "WatchlistEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchlistEntry_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_name_key" ON "Watchlist"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_position_key" ON "Watchlist"("position");

-- CreateIndex
CREATE INDEX "WatchlistEntry_securityId_idx" ON "WatchlistEntry"("securityId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistEntry_watchlistId_securityId_key" ON "WatchlistEntry"("watchlistId", "securityId");
