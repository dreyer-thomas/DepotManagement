-- AlterTable
ALTER TABLE "ProviderMapping" ADD COLUMN "fetchError" TEXT;
ALTER TABLE "ProviderMapping" ADD COLUMN "fetchedAt" TEXT;
ALTER TABLE "ProviderMapping" ADD COLUMN "historyFrom" TEXT;

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "fetchedAt" TEXT NOT NULL,
    CONSTRAINT "Price_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Price_securityId_date_source_key" ON "Price"("securityId", "date", "source");

