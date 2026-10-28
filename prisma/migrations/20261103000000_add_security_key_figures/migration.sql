-- Adds SecurityKeyFigures (story 9-6, owned by the classification module): a disposable key-figures cache.
-- CreateTable
CREATE TABLE "SecurityKeyFigures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "figures" TEXT NOT NULL,
    "fetchedAt" TEXT NOT NULL,
    CONSTRAINT "SecurityKeyFigures_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityKeyFigures_securityId_key" ON "SecurityKeyFigures"("securityId");
