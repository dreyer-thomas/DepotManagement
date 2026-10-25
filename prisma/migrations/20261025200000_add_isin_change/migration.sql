-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CorporateAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "newSecurityId" TEXT,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "ratioOld" TEXT NOT NULL,
    "ratioNew" TEXT NOT NULL,
    CONSTRAINT "CorporateAction_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CorporateAction_newSecurityId_fkey" FOREIGN KEY ("newSecurityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CorporateAction" ("date", "id", "ratioNew", "ratioOld", "securityId", "type") SELECT "date", "id", "ratioNew", "ratioOld", "securityId", "type" FROM "CorporateAction";
DROP TABLE "CorporateAction";
ALTER TABLE "new_CorporateAction" RENAME TO "CorporateAction";
CREATE INDEX "CorporateAction_securityId_idx" ON "CorporateAction"("securityId");
CREATE INDEX "CorporateAction_newSecurityId_idx" ON "CorporateAction"("newSecurityId");
CREATE UNIQUE INDEX "CorporateAction_securityId_type_date_key" ON "CorporateAction"("securityId", "type", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
