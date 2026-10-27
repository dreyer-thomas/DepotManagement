-- Adds TargetAllocation (story 8-5, owned by the rebalancing module).
-- CreateTable
CREATE TABLE "TargetAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "weights" TEXT NOT NULL,
    "threshold" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TargetAllocation_scope_key" ON "TargetAllocation"("scope");
