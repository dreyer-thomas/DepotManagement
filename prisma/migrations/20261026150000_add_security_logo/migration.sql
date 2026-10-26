-- Adds SecurityLogo (story 3-6, owned by the logos module).
-- CreateTable
CREATE TABLE "SecurityLogo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provider" TEXT,
    "fileName" TEXT,
    "contentType" TEXT,
    "fetchedAt" TEXT NOT NULL,
    CONSTRAINT "SecurityLogo_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityLogo_securityId_key" ON "SecurityLogo"("securityId");
