-- Adds SecurityClassification (story 7-1, owned by the classification module).
-- CreateTable
CREATE TABLE "SecurityClassification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "assetClass" TEXT,
    "assetClassSource" TEXT,
    "assetClassManual" TEXT,
    "sector" TEXT,
    "sectorSource" TEXT,
    "sectorManual" TEXT,
    "industry" TEXT,
    "industrySource" TEXT,
    "industryManual" TEXT,
    "region" TEXT,
    "regionSource" TEXT,
    "regionManual" TEXT,
    "country" TEXT,
    "countrySource" TEXT,
    "countryManual" TEXT,
    "companySize" TEXT,
    "companySizeSource" TEXT,
    "companySizeManual" TEXT,
    "currency" TEXT,
    "currencySource" TEXT,
    "currencyManual" TEXT,
    "providerSymbol" TEXT,
    "providerFetchedAt" TEXT,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "SecurityClassification_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityClassification_securityId_key" ON "SecurityClassification"("securityId");
