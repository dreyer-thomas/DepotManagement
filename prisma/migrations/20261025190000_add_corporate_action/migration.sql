-- CreateTable
CREATE TABLE "CorporateAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "ratioOld" TEXT NOT NULL,
    "ratioNew" TEXT NOT NULL,
    CONSTRAINT "CorporateAction_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CorporateAction_securityId_idx" ON "CorporateAction"("securityId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateAction_securityId_type_date_key" ON "CorporateAction"("securityId", "type", "date");
