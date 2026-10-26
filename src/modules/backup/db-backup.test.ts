import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";

// `renameSync` can be made to fail after the temp file was written; everything else is the real fs.
const fsControl = vi.hoisted(() => ({ failRename: false }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const renameSync: typeof actual.renameSync = (from, to) => {
    if (fsControl.failRename) {
      throw Object.assign(new Error("rename failed"), { code: "EXDEV" });
    }
    actual.renameSync(from, to);
  };
  return { ...actual, default: { ...actual, renameSync }, renameSync };
});

// `@/db` resolves DATABASE_URL on import: point it at a temp file so nothing touches the home directory.
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

import {
  BACKUP_CHECK_INTERVAL_MS,
  backupKeep,
  backupStatus,
  DEFAULT_BACKUP_KEEP,
  dbBackupFileName,
  runDatabaseBackup,
  startBackupScheduler,
  stopBackupScheduler,
} from "./db-backup";

const NOW = new Date("2026-10-26T08:00:00Z");
const now = () => NOW;

let db: TestDatabase;
let dir: string;
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;
let info: MockInstance<typeof console.info>;

const logs = () =>
  [...warn.mock.calls, ...error.mock.calls, ...info.mock.calls].map((call) => call.join(" ")).join("\n");

beforeEach(() => {
  db = createTestDatabase();
  dir = mkdtempSync(join(tmpdir(), "depot-backup-test-"));
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(async () => {
  fsControl.failRename = false;
  stopBackupScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => dbFile.removeFiles());

const env = (extra: Record<string, string> = {}) => ({ DATABASE_URL: db.url, BACKUP_DIR: dir, ...extra });

function touch(name: string, iso = "2026-10-01T00:00:00Z"): void {
  const path = join(dir, name);
  writeFileSync(path, "x");
  const time = new Date(iso);
  utimesSync(path, time, time);
}

describe("runDatabaseBackup", () => {
  it("copies committed rows that sit only in the WAL into depot-<date>.sqlite with mode 0600", async () => {
    await db.client.depot.create({ data: { name: "Hauptdepot", broker: "COMDIRECT" } });
    await db.client.depot.create({ data: { name: "Zweitdepot", broker: "FINANZEN_ZERO" } });
    const walPath = `${db.url.slice("file:".length)}-wal`;
    expect(statSync(walPath).size).toBeGreaterThan(0);

    const result = await runDatabaseBackup({ env: env(), now });

    expect(result).toEqual({ ok: true, fileName: "depot-2026-10-26.sqlite", skipped: false, removed: 0 });
    expect(readdirSync(dir)).toEqual(["depot-2026-10-26.sqlite"]);
    const target = join(dir, "depot-2026-10-26.sqlite");
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(statSync(target).mode & 0o077).toBe(0);
    const copy = new Database(target, { readonly: true, fileMustExist: true });
    try {
      const rows = copy.prepare("SELECT name FROM Depot ORDER BY name").all();
      expect(rows).toEqual([{ name: "Hauptdepot" }, { name: "Zweitdepot" }]);
    } finally {
      copy.close();
    }
    expect(backupStatus({ env: env() })).toEqual({
      lastSuccessAt: statSync(target).mtime.toISOString(),
      lastAttemptFailed: false,
    });
    expect(logs()).toContain("depot-2026-10-26.sqlite");
    expect(logs()).not.toContain(dir);
  });

  it("uses the Europe/Berlin date for the file name", async () => {
    const result = await runDatabaseBackup({ env: env(), now: () => new Date("2026-10-25T23:30:00Z") });
    expect(result).toMatchObject({ ok: true, fileName: "depot-2026-10-26.sqlite" });
  });

  it("creates a missing BACKUP_DIR", async () => {
    const nested = join(dir, "a", "b");
    const result = await runDatabaseBackup({ env: env({ BACKUP_DIR: nested }), now });
    expect(result.ok).toBe(true);
    expect(readdirSync(nested)).toEqual(["depot-2026-10-26.sqlite"]);
    expect(statSync(nested).mode & 0o777).toBe(0o700);
  });

  it("skips the copy when today's file already exists, without a status change", async () => {
    touch("depot-2026-10-26.sqlite");
    const result = await runDatabaseBackup({ env: env(), now });
    expect(result).toEqual({ ok: true, fileName: "depot-2026-10-26.sqlite", skipped: true, removed: 0 });
    expect(readFileSync(join(dir, "depot-2026-10-26.sqlite"), "utf8")).toBe("x");
    expect(backupStatus({ env: env() })).toEqual({
      lastSuccessAt: "2026-10-01T00:00:00.000Z",
      lastAttemptFailed: false,
    });
  });

  it("keeps only the newest BACKUP_KEEP dated files and never touches other files", async () => {
    for (const date of ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]) {
      touch(dbBackupFileName(date));
    }
    touch("depotmanagement-export-20261020-101500.json");
    touch("notes.txt");
    touch("depot-2026-10-01.sqlite.tmp");

    const result = await runDatabaseBackup({ env: env({ BACKUP_KEEP: "3" }), now });

    expect(result).toMatchObject({ ok: true, removed: 3 });
    expect(readdirSync(dir).sort()).toEqual([
      "depot-2026-10-01.sqlite.tmp",
      "depot-2026-10-24.sqlite",
      "depot-2026-10-25.sqlite",
      "depot-2026-10-26.sqlite",
      "depotmanagement-export-20261020-101500.json",
      "notes.txt",
    ]);
  });

  it("only warns when an old backup cannot be deleted", async () => {
    // A directory with the backup name cannot be unlinked.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "depot-2026-10-01.sqlite"));
    const result = await runDatabaseBackup({ env: env({ BACKUP_KEEP: "1" }), now });
    expect(result).toMatchObject({ ok: true, removed: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("depot-2026-10-01.sqlite"));
    expect(backupStatus({ env: env() }).lastAttemptFailed).toBe(false);
  });

  it("fails without a final file when BACKUP_DIR is a regular file", async () => {
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "x");
    const result = await runDatabaseBackup({ env: env({ BACKUP_DIR: file }), now });
    expect(result).toEqual({ ok: false });
    expect(backupStatus({ env: env({ BACKUP_DIR: file }) })).toEqual({
      lastSuccessAt: null,
      lastAttemptFailed: true,
    });
    expect(error).toHaveBeenCalledWith("Backup: database backup failed (depot-2026-10-26.sqlite, Error EEXIST)");
  });

  it("fails without a final or temp file when the DB file is missing, keeping the older success time", async () => {
    touch("depot-2026-10-25.sqlite", "2026-10-25T02:00:00Z");
    const result = await runDatabaseBackup({
      env: env({ DATABASE_URL: `file:${join(dir, "missing.db")}` }),
      now,
    });
    expect(result).toEqual({ ok: false });
    expect(readdirSync(dir)).toEqual(["depot-2026-10-25.sqlite"]);
    expect(backupStatus({ env: env() })).toEqual({
      lastSuccessAt: "2026-10-25T02:00:00.000Z",
      lastAttemptFailed: true,
    });
    expect(logs()).not.toContain(dir);
  });

  it("fails with NoDatabaseFile for an in-memory database URL", async () => {
    const result = await runDatabaseBackup({ env: env({ DATABASE_URL: "file::memory:" }), now });
    expect(result).toEqual({ ok: false });
    expect(error).toHaveBeenCalledWith("Backup: database backup failed (depot-2026-10-26.sqlite, NoDatabaseFile)");
  });

  it("discards a temp file left by a killed run", async () => {
    writeFileSync(join(dir, "depot-2026-10-26.sqlite.tmp"), "not a database");
    const result = await runDatabaseBackup({ env: env(), now });
    expect(result.ok).toBe(true);
    expect(readdirSync(dir)).toEqual(["depot-2026-10-26.sqlite"]);
  });

  it("removes the temp file when the copy fails after it was written, logging the error code", async () => {
    fsControl.failRename = true;
    const result = await runDatabaseBackup({ env: env(), now });
    expect(result).toEqual({ ok: false });
    expect(readdirSync(dir)).toEqual([]);
    expect(error).toHaveBeenCalledWith("Backup: database backup failed (depot-2026-10-26.sqlite, Error EXDEV)");
  });

  it("leaves no file when the copy cannot be written to a read-only BACKUP_DIR", async () => {
    chmodSync(dir, 0o500);
    try {
      const result = await runDatabaseBackup({ env: env(), now });
      expect(result).toEqual({ ok: false });
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("recovers after a failure: the next successful run clears the warning", async () => {
    await runDatabaseBackup({ env: env({ DATABASE_URL: `file:${join(dir, "missing.db")}` }), now });
    expect(backupStatus({ env: env() }).lastAttemptFailed).toBe(true);
    const result = await runDatabaseBackup({ env: env(), now });
    expect(result.ok).toBe(true);
    const target = join(dir, "depot-2026-10-26.sqlite");
    expect(backupStatus({ env: env() })).toEqual({
      lastSuccessAt: statSync(target).mtime.toISOString(),
      lastAttemptFailed: false,
    });
  });

  it("joins a run already in progress instead of starting a second one", async () => {
    const first = runDatabaseBackup({ env: env(), now });
    const second = runDatabaseBackup({ env: env(), now });
    expect(second).toBe(first);
    expect((await first).ok).toBe(true);
  });
});

describe("backupKeep", () => {
  it("defaults to 30 when empty or unset, without a warning", () => {
    expect(DEFAULT_BACKUP_KEEP).toBe(30);
    expect(backupKeep({})).toBe(30);
    expect(backupKeep({ BACKUP_KEEP: " " })).toBe(30);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts a positive integer", () => {
    expect(backupKeep({ BACKUP_KEEP: "7" })).toBe(7);
  });

  it.each(["abc", "0", "-2", "1.5"])("treats %s as 30 with one warning naming BACKUP_KEEP only", (value) => {
    expect(backupKeep({ BACKUP_KEEP: value })).toBe(30);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("Backup: BACKUP_KEEP is not a positive integer, keeping 30 backups");
  });
});

describe("backupStatus", () => {
  it("reports no success and no failure for an empty or missing BACKUP_DIR", () => {
    expect(backupStatus({ env: env() })).toEqual({ lastSuccessAt: null, lastAttemptFailed: false });
    expect(backupStatus({ env: env({ BACKUP_DIR: join(dir, "missing") }) })).toEqual({
      lastSuccessAt: null,
      lastAttemptFailed: false,
    });
  });

  it("takes the newest mtime of the dated backups only", () => {
    touch("depot-2026-10-24.sqlite", "2026-10-24T02:00:00Z");
    touch("depot-2026-10-25.sqlite", "2026-10-25T02:00:00Z");
    touch("notes.txt", "2026-10-26T02:00:00Z");
    expect(backupStatus({ env: env() }).lastSuccessAt).toBe("2026-10-25T02:00:00.000Z");
  });
});

describe("startBackupScheduler", () => {
  it("runs on start and once per new Berlin date, and starts only once per process", async () => {
    vi.useFakeTimers();
    let current = new Date("2026-10-26T09:00:00Z"); // 10:00 Berlin
    const run = vi.fn(async () => undefined);
    expect(startBackupScheduler({ run, now: () => current })).toBe(true);
    expect(startBackupScheduler({ run, now: () => current })).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    current = new Date("2026-10-26T10:00:00Z"); // 11:00 Berlin, same date
    await vi.advanceTimersByTimeAsync(BACKUP_CHECK_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);

    current = new Date("2026-10-26T23:30:00Z"); // 2026-10-27 00:30 Berlin
    await vi.advanceTimersByTimeAsync(BACKUP_CHECK_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never starts a second run while one is still running", async () => {
    vi.useFakeTimers();
    let current = new Date("2026-10-26T09:00:00Z");
    let finish: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    startBackupScheduler({ run, now: () => current });
    await vi.advanceTimersByTimeAsync(0);
    current = new Date("2026-10-27T09:00:00Z");
    await vi.advanceTimersByTimeAsync(BACKUP_CHECK_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(BACKUP_CHECK_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs a throwing run without throwing out of the scheduler", async () => {
    const run = vi.fn(async () => {
      throw new RangeError("boom");
    });
    startBackupScheduler({ run, now });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("Backup: scheduled run failed (RangeError)"));
  });

  it("writes today's backup with the default run", async () => {
    startBackupScheduler({ env: env(), now });
    await vi.waitFor(() => expect(readdirSync(dir)).toEqual(["depot-2026-10-26.sqlite"]));
  });
});
