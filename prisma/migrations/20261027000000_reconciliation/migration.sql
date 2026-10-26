-- Story 2.9: ADJUSTMENT transaction type (SQLite stores the enum as TEXT, no schema change), an optional
-- Transaction note and the reconciliation runs with their user-entered rows (owned by the ledger module).
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "note" TEXT;

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depotId" TEXT NOT NULL,
    "statementDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TEXT NOT NULL,
    "finishedAt" TEXT,
    CONSTRAINT "ReconciliationRun_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReconciliationRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "securityId" TEXT,
    "statementValue" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ReconciliationRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReconciliationRow_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReconciliationRun_depotId_idx" ON "ReconciliationRun"("depotId");

-- CreateIndex
CREATE INDEX "ReconciliationRow_securityId_idx" ON "ReconciliationRow"("securityId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationRow_runId_securityId_key" ON "ReconciliationRow"("runId", "securityId");

