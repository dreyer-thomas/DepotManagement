-- Adds PriceMark (story 12-2, owned by the marks module): stop and target per Security.
-- CreateTable
CREATE TABLE "PriceMark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "stopType" TEXT,
    "stopValue" TEXT,
    "stopSource" TEXT,
    "stopSetDate" TEXT,
    "targetPrice" TEXT,
    "targetSource" TEXT,
    "targetSetDate" TEXT,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "PriceMark_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceMark_securityId_key" ON "PriceMark"("securityId");
