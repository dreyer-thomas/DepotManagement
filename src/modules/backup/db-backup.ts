// Daily DB file backup (story 6.3, AD-13): a consistent copy of the SQLite file via better-sqlite3
// `backup()` on its own connection (safe under WAL) to `BACKUP_DIR/depot-<YYYY-MM-DD>.sqlite`, then
// rotation to the newest `BACKUP_KEEP` dated files. An in-process scheduler runs it once at start (when
// today's file is missing) and once per new Europe/Berlin date. The outcome of the last attempt lives in
// process memory; the last success time comes from the files, so it survives restarts.
// Logs carry only file names, counts and error names.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { businessDate } from "@/core/dates";
import { BUSY_TIMEOUT_MS } from "@/db";
import { databaseFilePath, resolveDatabaseUrl } from "@/db/database-url";
import { backupDir } from "./restore";

/** Number of daily DB backups kept when `BACKUP_KEEP` is empty, unset or invalid. */
export const DEFAULT_BACKUP_KEEP = 30;

/** How often the scheduler checks whether the Berlin business date changed. */
export const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const DB_BACKUP_NAME = /^depot-\d{4}-\d{2}-\d{2}\.sqlite$/;

type Env = Record<string, string | undefined>;

export type DbBackupDeps = {
  env?: Env;
  /** Current time; defaults to `new Date()`. */
  now?: () => Date;
};

export type DbBackupResult = { ok: true; fileName: string; skipped: boolean; removed: number } | { ok: false };

export type BackupStatus = { lastSuccessAt: string | null; lastAttemptFailed: boolean };

/** `BACKUP_KEEP` as a positive integer; empty/unset or invalid means `DEFAULT_BACKUP_KEEP`. */
export function backupKeep(env: Env = process.env): number {
  const raw = env.BACKUP_KEEP?.trim();
  if (!raw) return DEFAULT_BACKUP_KEEP;
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  console.warn(`Backup: BACKUP_KEEP is not a positive integer, keeping ${DEFAULT_BACKUP_KEEP} backups`);
  return DEFAULT_BACKUP_KEEP;
}

/** File name of the DB backup of a business date, e.g. `depot-2026-10-26.sqlite`. */
export function dbBackupFileName(date: string): string {
  return `depot-${date}.sqlite`;
}

type StatusState = {
  lastAttempt: { ok: boolean; at: string } | null;
  running: Promise<DbBackupResult> | null;
};

// Survives module re-evaluation (dev reloads, duplicate bundles) within one process.
const STATUS = Symbol.for("depotmanagement.dbBackupStatus");
const SCHEDULER = Symbol.for("depotmanagement.dbBackupScheduler");
type SchedulerState = { timer: ReturnType<typeof setInterval>; lastRunDate: string | null };
type BackupGlobal = typeof globalThis & { [STATUS]?: StatusState; [SCHEDULER]?: SchedulerState };

function statusState(): StatusState {
  const global = globalThis as BackupGlobal;
  global[STATUS] ??= { lastAttempt: null, running: null };
  return global[STATUS];
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/** Error name plus its string `code` (e.g. `Error ENOSPC`); never the message or a path. */
function errorLabel(error: unknown): string {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? `${errorName(error)} ${code}` : errorName(error);
}

function noDatabaseFile(): Error {
  const error = new Error("DATABASE_URL does not name a database file");
  error.name = "NoDatabaseFile";
  return error;
}

/** Copies the DB file to `target` through a temp file, so a broken copy never carries the final name. */
async function copyDatabase(env: Env, dir: string, fileName: string): Promise<void> {
  const source = databaseFilePath(resolveDatabaseUrl(env));
  if (!source) throw noDatabaseFile();
  const target = join(dir, fileName);
  const temp = `${target}.tmp`;
  try {
    // A temp file left by a killed run is discarded; the new one is private before any page is copied.
    rmSync(temp, { force: true });
    writeFileSync(temp, "", { mode: 0o600 });
    const db = new Database(source, { fileMustExist: true, timeout: BUSY_TIMEOUT_MS });
    try {
      await db.backup(temp);
    } finally {
      db.close();
    }
    chmodSync(temp, 0o600);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Deletes all but the newest `keep` dated backups (by name); other files are never touched. */
function rotate(dir: string, keep: number): number {
  const dated = readdirSync(dir)
    .filter((name) => DB_BACKUP_NAME.test(name))
    .sort();
  let removed = 0;
  for (const name of dated.slice(0, Math.max(0, dated.length - keep))) {
    try {
      unlinkSync(join(dir, name));
      removed += 1;
    } catch (error) {
      console.warn(`Backup: could not delete old backup ${name} (${errorName(error)})`);
    }
  }
  return removed;
}

async function backupOnce(deps: DbBackupDeps): Promise<DbBackupResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const state = statusState();
  let fileName = "";
  try {
    fileName = dbBackupFileName(businessDate(now()));
    const dir = backupDir(env);
    if (existsSync(join(dir, fileName))) return { ok: true, fileName, skipped: true, removed: 0 };
    const keep = backupKeep(env);
    console.info(`Backup: database backup started (${fileName})`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    await copyDatabase(env, dir, fileName);
    state.lastAttempt = { ok: true, at: now().toISOString() };
    const removed = rotate(dir, keep);
    console.info(`Backup: database backup finished (${fileName}, ${removed} old backups removed)`);
    return { ok: true, fileName, skipped: false, removed };
  } catch (error) {
    let at: string;
    try {
      at = now().toISOString();
    } catch {
      at = new Date().toISOString();
    }
    state.lastAttempt = { ok: false, at };
    const detail = fileName ? `${fileName}, ${errorLabel(error)}` : errorLabel(error);
    console.error(`Backup: database backup failed (${detail})`);
    return { ok: false };
  }
}

/**
 * Writes today's DB backup unless it already exists (skipped, counts as success, no status change), then
 * rotates. Records the outcome for `backupStatus`. Never throws; a run already in progress is joined.
 */
export function runDatabaseBackup(deps: DbBackupDeps = {}): Promise<DbBackupResult> {
  const state = statusState();
  if (state.running) return state.running;
  const running = backupOnce(deps).finally(() => {
    state.running = null;
  });
  state.running = running;
  return running;
}

/** Newest `mtime` (ISO) of the dated backups in `BACKUP_DIR`, or null. */
function lastBackupFileTime(env: Env): string | null {
  const dir = backupDir(env);
  let newest: number | null = null;
  for (const name of readdirSync(dir)) {
    if (!DB_BACKUP_NAME.test(name)) continue;
    try {
      const mtime = statSync(join(dir, name)).mtime.getTime();
      if (newest === null || mtime > newest) newest = mtime;
    } catch {
      // A file removed between listing and stat is ignored.
    }
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/** The last successful backup time (from the files) and whether the last attempt failed. Never throws. */
export function backupStatus(deps: Pick<DbBackupDeps, "env"> = {}): BackupStatus {
  const lastAttemptFailed = statusState().lastAttempt?.ok === false;
  let lastSuccessAt: string | null = null;
  try {
    lastSuccessAt = lastBackupFileTime(deps.env ?? process.env);
  } catch {
    lastSuccessAt = null;
  }
  return { lastSuccessAt, lastAttemptFailed };
}

export type BackupSchedulerDeps = DbBackupDeps & {
  /** The backup run; defaults to `runDatabaseBackup` with `env` and `now`. */
  run?: () => Promise<unknown>;
};

/**
 * Starts the backup scheduler unless it already runs in this process (then a no-op returning false):
 * an immediate tick, then an hourly check (timer `unref()`'d); each tick runs at most once per Berlin date.
 */
export function startBackupScheduler(deps: BackupSchedulerDeps = {}): boolean {
  const global = globalThis as BackupGlobal;
  if (global[SCHEDULER]) return false;
  const now = deps.now ?? (() => new Date());
  const run = deps.run ?? (() => runDatabaseBackup({ env: deps.env, now }));
  let running = false;

  const state = { lastRunDate: null } as Omit<SchedulerState, "timer"> & Partial<Pick<SchedulerState, "timer">>;
  const tick = () => {
    let today: string;
    try {
      today = businessDate(now());
    } catch {
      return;
    }
    if (running || state.lastRunDate === today) return;
    state.lastRunDate = today;
    running = true;
    Promise.resolve()
      .then(() => run())
      .catch((error: unknown) => {
        console.error(`Backup: scheduled run failed (${errorName(error)})`);
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, BACKUP_CHECK_INTERVAL_MS);
  timer.unref?.();
  state.timer = timer;
  global[SCHEDULER] = state as SchedulerState;
  tick();
  return true;
}

/** Stops the scheduler of this process and resets the in-memory status (tests). */
export function stopBackupScheduler(): void {
  const global = globalThis as BackupGlobal;
  const state = global[SCHEDULER];
  if (state) {
    clearInterval(state.timer);
    delete global[SCHEDULER];
  }
  delete global[STATUS];
}
