---
title: 'Daily database backup (story 6-3)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '170b3eaaf9bc6d860ef3dfe8d418e060f6c103e1'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The SQLite file is the only copy of Tommy's history; a disk or operator error loses it, and nothing copies it automatically.

**Approach:** The `backup` module gets a daily DB file backup: a consistent copy via better-sqlite3 `backup()` to `BACKUP_DIR/depot-<YYYY-MM-DD>.sqlite`, run by a small in-process daily scheduler (started from `startBackgroundJobs`, once at start if today's file is missing, then once per new Europe/Berlin date), keeping only the newest `BACKUP_KEEP` files. Settings "Datensicherung" shows the last successful backup time, and a warning when the last attempt failed. The README documents restoring from such a file.

## Boundaries & Constraints

**Always:**
- Copy with better-sqlite3 `Database#backup()` from its own connection to the DB file (`databaseFilePath(resolveDatabaseUrl(env))`, opened with `fileMustExist: true` and `timeout: BUSY_TIMEOUT_MS`, closed in `finally`) — safe under WAL. Write to `depot-<date>.sqlite.tmp` first, then `chmod 0600` and `rename` to the final name, so a broken copy never carries the final name; remove the temp file on failure.
- `<date>` is `businessDate(now)` (Europe/Berlin). `BACKUP_DIR` resolution reuses `backupDir(env)` (empty = `~/.depotmanagement/backups`), created with `recursive: true` if missing.
- `BACKUP_KEEP`: a positive integer; empty or unset = `DEFAULT_BACKUP_KEEP` = 30; anything else = 30 plus one `console.warn` naming the variable (never its value).
- Rotation runs only after a successful backup and considers only files whose name matches exactly `^depot-\d{4}-\d{2}-\d{2}\.sqlite$`; sorted by name, all but the newest `BACKUP_KEEP` are deleted. Pre-restore exports, temp files and other files are never touched. A failed deletion is a `console.warn` and does not turn the backup into a failure.
- Scheduler: one per process (globalThis symbol guard like `startPriceScheduler`); an immediate tick, then an hourly (`unref()`'d) tick; each tick computes today's Berlin date and runs at most once per date, skipping the copy when today's file already exists (that counts as success, no status change). Never two runs at once.
- Status: the outcome of the last attempt (`ok` / `failed` and its instant) is kept in process memory (globalThis); the last successful backup time is the newest matching file's `mtime` in `BACKUP_DIR` (survives restarts). `backupStatus(deps?)` returns `{ lastSuccessAt: string | null; lastAttemptFailed: boolean }` (ISO instant) and never throws.
- Logs: start/finish/failure lines carry only file names, counts and the error `name` — never absolute paths, amounts or credentials.
- Settings "Datensicherung": when `lastAttemptFailed`, a MUI `Alert severity="warning"`: "Die letzte Datenbanksicherung ist fehlgeschlagen. Letzte erfolgreiche Sicherung: <DD.MM.YYYY, HH:mm>." or "… Noch keine erfolgreiche Sicherung."; otherwise, when `lastSuccessAt` is set, a `body2` secondary line "Letzte Datenbanksicherung: <DD.MM.YYYY, HH:mm>". Time via `formatDateTime` from `src/core/format.ts`.

**Never:**
- Copy the DB with `fs.copyFile`, `VACUUM INTO` through Prisma, or any approach that can read a torn WAL state.
- Add a Prisma migration or store backup status in the database.
- Touch JSON export/restore behaviour, pre-restore export files, or `sprint-status.yaml`.
- Run the backup during `next build` or in tests against the real `~/.depotmanagement`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Daily copy | WAL DB with committed rows (some only in the `-wal` file), empty `BACKUP_DIR`, now = 2026-10-26 | `depot-2026-10-26.sqlite` exists, mode 0600, opens with better-sqlite3 and contains every committed row; no `.tmp` left | No error expected |
| Already done today | `depot-2026-10-26.sqlite` exists | No copy, file unchanged, status not failed | — |
| Rotation | `BACKUP_KEEP=3`, five dated files + a pre-restore export + `notes.txt` | Newest three dated files remain; export and `notes.txt` untouched | Failed unlink → warn only |
| Invalid keep | `BACKUP_KEEP=abc` / `0` / `-2` / `1.5` | Treated as 30 | One warn naming `BACKUP_KEEP` |
| Backup fails | `BACKUP_DIR` is a regular file, or DB file missing | No final file; status `lastAttemptFailed: true`; `lastSuccessAt` from older files (or null) | `console.error` with error name; never throws out of the scheduler |
| Recovery | After a failure, the next run succeeds | `lastAttemptFailed: false`, `lastSuccessAt` = new file's mtime | — |
| Scheduler | Start at 2026-10-26 10:00, ticks at 11:00 and next day 00:30 Berlin | Runs on start and on 2026-10-27 only; second `start` call returns false | — |
| Settings warning | Status failed, last success 2026-10-25T02:00:00Z | Warning Alert with "25.10.2026, 03:00" | — |

</intent-contract>

## Code Map

- `src/modules/prices/scheduler.ts` -- pattern to mirror: globalThis `Symbol.for(...)` guard, `businessDate(now())`, hourly `setInterval` + `unref()`, immediate tick, `stop…` for tests; `SCHEDULER_CHECK_INTERVAL_MS`.
- `src/instrumentation-node.ts` -- `startBackgroundJobs()` (skips `phase-production-build`); add `startBackupScheduler()` from `@/modules/backup` here. `src/instrumentation-node.test.ts` mocks prices/logos/news modules — must also mock the backup scheduler so no test writes to the real home dir.
- `src/modules/backup/restore.ts:44` -- `backupDir(env)`; reuse, do not duplicate. `src/modules/backup/index.ts` -- module entry point; add exports.
- `src/db/index.ts` -- `BUSY_TIMEOUT_MS`, WAL adapter; `src/db/database-url.ts` -- `resolveDatabaseUrl`, `databaseFilePath` (undefined for non-file/`:memory:` → backup fails with a clear name, e.g. an `Error` named `NoDatabaseFile`).
- `test/helpers/migrated-db-file.ts` -- `createMigratedDatabaseFile()` gives a temp DB file URL for tests; `test/helpers/test-db.ts` `createTestDatabase()` for a Prisma client on it (write rows, keep the client open so they sit in the WAL).
- `src/core/dates.ts:34` `businessDate`; `src/core/format.ts:96` `formatDateTime(isoInstant)` → `DD.MM.YYYY, HH:mm` Berlin.
- `src/app/(app)/settings/page.tsx` + `page.test.tsx` -- "Datensicherung" section (server component; test uses `useMigratedDatabaseForSingleton` and `renderText`).
- `README.md` "Data export" / "### Restore" sections; `.env.example` `BACKUP_DIR`/`BACKUP_KEEP` comment.
- `better-sqlite3@12.11.1` is already a dependency and in `serverExternalPackages`; types `@types/better-sqlite3`.

## Tasks & Acceptance

**Execution:**
- `src/modules/backup/db-backup.ts` -- `DEFAULT_BACKUP_KEEP`, `backupKeep(env)`, `dbBackupFileName(date)`, `runDatabaseBackup(deps?)` (deps: `env`, `now`; copy, rotate, record status; returns `{ ok: true, fileName, skipped, removed } | { ok: false }`), `backupStatus(deps?)`, `startBackupScheduler(deps?)`, `stopBackupScheduler()`; status state on globalThis with a reset used by `stopBackupScheduler`.
- `src/modules/backup/index.ts` -- export the above; update the header comment.
- `src/instrumentation-node.ts` -- start the backup scheduler in `startBackgroundJobs`; update its doc comment.
- `src/instrumentation-node.test.ts` -- mock `@/modules/backup` (or its scheduler) and assert it is started once and not during build.
- `src/app/(app)/settings/page.tsx` -- read `backupStatus()` and render the warning / last-backup line in "Datensicherung".
- `src/app/_components/backup/labels.ts` -- German texts for the warning and the line (functions taking the formatted time or null).
- `README.md` -- "Daily database backup" subsection: file name, schedule, `BACKUP_KEEP` default, WAL-safe copy, Settings warning, and "Restoring from a backup file": stop the app, copy `depot-<date>.sqlite` over the `DATABASE_URL` file, delete its `-wal`/`-shm` files, run `npx prisma migrate deploy` (an older backup may lack newer migrations), start the app.
- `.env.example` -- `BACKUP_KEEP` comment: number of daily DB backups kept, empty = 30.
- Tests: `src/modules/backup/db-backup.test.ts` (every matrix row except Settings; temp dirs and a temp migrated DB via `env.DATABASE_URL`; fake `now`; scheduler with `vi.useFakeTimers` or injected `now` and an injected run), `src/app/(app)/settings/page.test.tsx` (warning with time; "Noch keine erfolgreiche Sicherung"; last-backup line; nothing when no backup and no failure) with `BACKUP_DIR` pointed at a temp dir.

**Acceptance Criteria:**
- Given `BACKUP_DIR` and `BACKUP_KEEP` are set, when the app starts without today's backup or a new Berlin day begins, then `BACKUP_DIR/depot-<YYYY-MM-DD>.sqlite` is written via `backup()` and only the newest `BACKUP_KEEP` dated backups remain.
- Given the last backup attempt failed, when Tommy opens Settings, then "Datensicherung" shows a warning with the time of the last successful backup, and the failure is in the log.
- Given the README, when a reader looks for restoring from a DB backup file, then a section explains the steps.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 29 findings — high 0, medium 0, low 25, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: a failed scheduled run is not retried until the next Berlin date — real, but one missed day after a transient failure is visible in Settings, older backups exist, and a retry branch adds state the spec deliberately left out ("at most once per date").
  - `[low]` `[patch]` Blind: a `.tmp` left by a killed process is reused as the `backup()` destination — fixed: `copyDatabase` removes any existing temp file first; test with a junk `.tmp` added.
  - `[low]` `[patch]` Blind: the temp copy is world-readable (umask) until the chmod, and a new `BACKUP_DIR` gets 0755 — fixed: empty temp file created with mode 0600 before the copy, `BACKUP_DIR` created with mode 0700; mode tests added.
  - `[low]` `[patch]` Blind: the failure log shows only `Error`/`SqliteError` — fixed: the error's `code` is appended (e.g. `Error ENOSPC`), still no paths or messages.
  - `[low]` `[patch]` Blind: README does not say the default `BACKUP_DIR` shares the DB's disk — fixed: sentence advising another disk or a synced/off-site location.
  - `[low]` `[patch]` Blind: README restore steps overwrite the live DB without a safety copy and omit ownership — fixed: new step keeps a copy of the DB and its `-wal`/`-shm`; note that the copy must stay readable/writable by the app user.
  - `[low]` `[reject]` Blind: a lowered `BACKUP_KEEP` applies only after the next real backup — rare config change, takes effect the next day; not worth changing the skip path.
  - `[low]` `[reject]` Blind: `lastSuccessAt` counts any matching file, including hand-copied or future-dated ones — `BACKUP_DIR` is written by the app; guarding against manual files adds checks no AC needs.
  - `[false]` `[reject]` Blind: a second caller with different deps silently joins the first run — the only production caller is the scheduler with fixed deps; no caller passes differing deps.
  - `[low]` `[patch]` Blind: the temp-cleanup test never creates a temp file (and fails as root) — grouped with the verification-gap finding; fixed: test with a failing `renameSync` (partial `node:fs` mock) after the temp file exists, asserting no `.tmp` and no final file; read-only test renamed to what it checks.
  - `[low]` `[reject]` Blind: a throwing `import("@/modules/backup")` stops the logo start-up run — only if better-sqlite3 fails to load, in which case Prisma's adapter is broken too; a try/catch adds a guard for an unreachable state.
  - `[low]` `[reject]` Blind: `errorName` duplicated again — the codebase keeps this one-line helper per file (restore.ts, instrumentation-node.ts); no caller diverges.
  - `[low]` `[reject]` Blind: no scheduler test for a run returning `{ ok: false }` — follows from the rejected retry finding; the "once per date" behaviour is covered.
  - `[low]` `[reject]` Edge: a future-dated dated file can make rotation delete today's new backup when `BACKUP_KEEP` is small — needs a clock that went backwards; unlikely, fix adds a guard.
  - `[low]` `[reject]` Edge: `readdirSync` in `rotate` throwing after a successful copy records a failure — the directory was just created/written; practically unreachable.
  - `[low]` `[patch]` Edge: temp file readable during the copy — same root cause as Blind row 3; fixed there.
  - `[low]` `[reject]` Edge: `rmSync` in the catch can mask the original error — needs EACCES on a directory the copy just wrote to; unlikely, fix adds a nested try.
  - `[low]` `[patch]` Edge: orphaned temp files from killed runs — same root cause as Blind row 2; today's temp is now removed before each copy (older-dated orphans stay, rare).
  - `[low]` `[reject]` Edge: today's name existing as a directory or empty file counts as done — only by manual tampering; fix adds checks.
  - `[low]` `[reject]` Edge: no retry after a failed run — same as Blind row 1.
  - `[false]` `[reject]` Edge: joining a run with different deps — same refutation as Blind row 9.
  - `[low]` `[reject]` Edge: a dated-name directory affects `lastSuccessAt` — manual tampering only (same as Blind row 8).
  - `[low]` `[reject]` Edge: an mtime beyond year 9999 makes `formatDateTime` throw — unreachable for files the app writes.
  - `[low]` `[reject]` Edge: a failing backup-module import skips the logo run — same as Blind row 11.
  - `[false]` `[reject]` Edge claim: rotation failure can mark a backup failed, contrary to the spec — the spec says a failed *deletion* only warns, which holds (`unlinkSync` is caught); a `readdirSync` failure is a different case (Edge row 2).
  - `[low]` `[reject]` Edge claim: a lowered `BACKUP_KEEP` is not applied on a skipped start-up run — same as Blind row 7.
  - `[low]` `[patch]` Verification gap: the `rmSync(temp)` cleanup is never exercised by a test — fixed with the `renameSync`-failure test (grouped with Blind row 10).
  - `[low]` `[reject]` Intent: no unmocked end-to-end test from `register()` to a file, and the README restore steps are not executed — each link is tested (start wiring, real WAL copy against a real DB, Settings render after a real failed run); a full server run adds harness no AC asks for. The diff implements reading A (no operator actions owed).
  - `[false]` `[reject]` Intent: a skipped run leaves an earlier in-memory failure flagged — a skip needs today's file to exist, which a failed run never creates; the flag clears with the next real success.

## Design Notes

The status lives in memory because the app is exactly one process (AD-13) and a restart re-runs the backup when today's file is missing, so a persisting failure is recorded again within seconds; the last success time comes from the files themselves, so it survives restarts without a migration.

`backup()` on a second better-sqlite3 connection reads a consistent snapshot including WAL frames, and copies page by page without blocking Prisma's writers for long.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** The `backup` module now takes a daily SQLite backup: `runDatabaseBackup` copies the DB with better-sqlite3 `backup()` on its own connection (WAL-safe) into a private temp file (0600) and renames it to `BACKUP_DIR/depot-<YYYY-MM-DD>.sqlite` (Berlin date; `BACKUP_DIR` created 0700), then keeps only the newest `BACKUP_KEEP` dated files (default 30; invalid values warn and fall back). `startBackupScheduler` (started from `startBackgroundJobs`, never during `next build`, one per process) runs on start and once per new Berlin date, skipping when today's file exists. `backupStatus` reports the last success time (newest backup file mtime) and whether the last attempt failed (in memory). Settings → "Datensicherung" shows "Letzte Datenbanksicherung: …" or, after a failure, a warning with the last success time. README documents the backup and restoring from a backup file; `.env.example` documents `BACKUP_KEEP`.

**Files changed:**
- `src/modules/backup/db-backup.ts` (new) — copy, rotation, status, scheduler.
- `src/modules/backup/index.ts` — exports.
- `src/instrumentation-node.ts` — starts the backup scheduler.
- `src/app/(app)/settings/page.tsx`, `src/app/_components/backup/labels.ts` — status line / warning and German texts.
- `README.md`, `.env.example` — backup section, restore-from-file steps, `BACKUP_KEEP`.
- Tests: `src/modules/backup/db-backup.test.ts` (new), `src/app/(app)/settings/page.test.tsx`, `src/instrumentation-node.test.ts`, `src/instrumentation.test.ts` (backup scheduler mocked so no test backs up the home-dir DB).

**Review findings:** one pass, 29 findings (high 0, medium 0, low 25, false 4). 6 patch entries applied (all low: stale temp file removed before copy, private temp file and 0700 directory, error code in the failure log, README disk advice, README safety-copy step, real temp-cleanup test); 0 deferred; every rejected finding and its reason is in the Review Triage Log.

**Follow-up review recommended:** false — patched 0 high, 0 medium, 6 low.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (179 test files, 2493 tests). Every I/O matrix row is covered by a passing test (WAL-only rows in the copy, skip, rotation incl. failed unlink, invalid keep, both failure modes, recovery, scheduler timing and double start, Settings warning text).

**Residual risks:** a transient failure is retried only on the next Berlin day or restart; the failure flag is in-memory (cleared by a restart until the start-up run fails again); the README restore procedure was not executed against a running instance; `lastSuccessAt` trusts file mtimes in `BACKUP_DIR`.
