-- CreateTable
CREATE TABLE "Depot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "broker" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Depot_name_key" ON "Depot"("name");
