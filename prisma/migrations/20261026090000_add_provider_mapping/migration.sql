-- Adds ProviderMapping (story 3-1, owned by the prices module).
-- CreateTable
CREATE TABLE "ProviderMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "provider" TEXT,
    "symbol" TEXT,
    "origin" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "ProviderMapping_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderMapping_securityId_key" ON "ProviderMapping"("securityId");

