-- CreateTable
CREATE TABLE "Security" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "isin" TEXT,
    "cryptoSymbol" TEXT,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depotId" TEXT NOT NULL,
    "securityId" TEXT,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "quantity" TEXT,
    "price" TEXT,
    "amount" TEXT NOT NULL,
    "fee" TEXT NOT NULL,
    "tax" TEXT NOT NULL,
    CONSTRAINT "Transaction_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Security_isin_key" ON "Security"("isin");

-- CreateIndex
CREATE UNIQUE INDEX "Security_cryptoSymbol_key" ON "Security"("cryptoSymbol");

-- CreateIndex
CREATE INDEX "Transaction_securityId_idx" ON "Transaction"("securityId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_depotId_date_sequence_key" ON "Transaction"("depotId", "date", "sequence");
