// Creates a temp SQLite file with every committed migration applied. No `@/db` import, so it can
// run inside `vi.hoisted` before the `@/db` singleton resolves DATABASE_URL.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

const MIGRATIONS_DIR = resolve(__dirname, "../../prisma/migrations");

export type MigratedDatabaseFile = { url: string; removeFiles: () => void };

export function createMigratedDatabaseFile(): MigratedDatabaseFile {
  const dir = mkdtempSync(join(tmpdir(), "depot-test-db-"));
  const file = join(dir, "test.db");
  const sqlite = new Database(file);
  try {
    const folders = readdirSync(MIGRATIONS_DIR)
      .filter((name) => statSync(join(MIGRATIONS_DIR, name)).isDirectory())
      .sort();
    for (const folder of folders) {
      sqlite.exec(readFileSync(join(MIGRATIONS_DIR, folder, "migration.sql"), "utf8"));
    }
  } finally {
    sqlite.close();
  }
  return { url: `file:${file}`, removeFiles: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * For tests of code that uses the `@/db` singleton: call inside `vi.hoisted` so DATABASE_URL points
 * at a fresh migrated temp file before `@/db` is imported. Drops a cached singleton from globalThis.
 */
export function useMigratedDatabaseForSingleton(): MigratedDatabaseFile {
  const file = createMigratedDatabaseFile();
  process.env.DATABASE_URL = file.url;
  delete (globalThis as { prisma?: unknown }).prisma;
  return file;
}
