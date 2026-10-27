-- Adds TaxAllowance and TeilfreistellungOverride (story 8-3, owned by the tax module).
-- CreateTable
CREATE TABLE "TaxAllowance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "broker" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TeilfreistellungOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "TeilfreistellungOverride_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxAllowance_broker_year_key" ON "TaxAllowance"("broker", "year");

-- CreateIndex
CREATE UNIQUE INDEX "TeilfreistellungOverride_securityId_key" ON "TeilfreistellungOverride"("securityId");
