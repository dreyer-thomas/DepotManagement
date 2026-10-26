-- Adds ImportBatch and ImportItem (story 5-1, owned by the import module).
-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "ImportBatch_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "duplicateUpload" BOOLEAN NOT NULL DEFAULT false,
    "storedFile" TEXT,
    "status" TEXT NOT NULL,
    "documentType" TEXT,
    "reason" TEXT,
    "proposals" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "ImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ImportBatch_depotId_idx" ON "ImportBatch"("depotId");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "ImportItem_fileHash_idx" ON "ImportItem"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "ImportItem_batchId_position_key" ON "ImportItem"("batchId", "position");

