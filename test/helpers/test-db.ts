// Throwaway SQLite database for tests: never touches ~/.depotmanagement.
import { createPrismaClient } from "@/db";
import type { PrismaClient } from "@/db/generated/prisma/client";
import { createMigratedDatabaseFile } from "./migrated-db-file";

export type TestDatabase = { url: string; client: PrismaClient; cleanup: () => Promise<void> };

/** Creates a temp SQLite file, applies every committed migration in order and opens a client. */
export function createTestDatabase(): TestDatabase {
  const { url, removeFiles } = createMigratedDatabaseFile();
  const client = createPrismaClient(url);
  return {
    url,
    client,
    cleanup: async () => {
      await client.$disconnect();
      removeFiles();
    },
  };
}
