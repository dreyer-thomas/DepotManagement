import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseFilePath, defaultDatabasePath, resolveDatabaseUrl } from "@/db/database-url";

const REPO_ROOT = resolve(__dirname, "../..");
const tempDir = mkdtempSync(join(tmpdir(), "depot-db-test-"));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveDatabaseUrl", () => {
  it("returns DATABASE_URL when set and creates its directory", () => {
    const url = `file:${join(tempDir, "nested", "depot.db")}`;
    expect(resolveDatabaseUrl({ DATABASE_URL: url })).toBe(url);
    expect(existsSync(join(tempDir, "nested"))).toBe(true);
  });

  describe("fallback", () => {
    // Point os.homedir() into the temp dir so the developer's real home stays untouched.
    const fakeHome = join(tempDir, "home");
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

    beforeEach(() => {
      process.env.HOME = fakeHome;
      process.env.USERPROFILE = fakeHome;
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it.each([undefined, "", "   "])("falls back to the home-dir default for %j", (value) => {
      expect(homedir()).toBe(fakeHome);
      const expected = `file:${join(fakeHome, ".depotmanagement", "depot.db")}`;
      expect(resolveDatabaseUrl({ DATABASE_URL: value })).toBe(expected);
      expect(existsSync(join(fakeHome, ".depotmanagement"))).toBe(true);
    });
  });

  it("places the default database outside the repository", () => {
    const path = databaseFilePath(`file:${defaultDatabasePath()}`)!;
    expect(path.startsWith(REPO_ROOT + sep)).toBe(false);
  });
});

describe("Prisma client", () => {
  const savedUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it("opens SQLite in WAL mode with a busy timeout", async () => {
    // Set before importing @/db: its module-level singleton resolves DATABASE_URL on import.
    process.env.DATABASE_URL = `file:${join(tempDir, "pragma.db")}`;
    const { BUSY_TIMEOUT_MS, createPrismaClient } = await import("@/db");
    const client = createPrismaClient(process.env.DATABASE_URL);
    try {
      const [journal] = await client.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
      expect(journal.journal_mode).toBe("wal");
      const [busy] = await client.$queryRawUnsafe<{ timeout: bigint | number }[]>("PRAGMA busy_timeout");
      expect(Number(busy.timeout)).toBe(BUSY_TIMEOUT_MS);
    } finally {
      await client.$disconnect();
    }
  });
});
