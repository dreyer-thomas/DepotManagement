---
title: 'Restore from export (story 6-2)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: 'd6cb248359fa85cf7241dee1eab5bfd9e6e13b22'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The guard in replaceAllLogos that bumps the epoch instead of overwriting an existing logo file is never exercised by a test.
    evidence: |-
      restore.test.ts fixes `now` and pre-creates sec-b-1.png, sec-b-7.png and other-sec-5.png; none collides with <securityId>-<NOW epoch>, so the while(existsSync) loop body never runs. A collision needs the same millisecond epoch, which is unlikely in practice.
    location: >-
      src/modules/logos/restore.ts (replaceAllLogos)
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 6.1 lets Tommy export everything, but nothing can read the file back: he cannot recover from a mistake or move his data to the server.

**Approach:** Settings gets a "Wiederherstellen" button with a destructive confirm dialog (file + typed "WIEDERHERSTELLEN"). A server action hands the file to `backup.restoreExport`, which upgrades and validates it, writes an automatic export of the current data to `BACKUP_DIR`, and then replaces all data in one DB transaction via `ledger.replaceAll`, `prices.replaceAll` and `logos.replaceAll`, after clearing import staging and news.

## Boundaries & Constraints

**Always:**
- Pipeline, in this order; each step that fails returns `{ ok: false, reason, detail? }` and leaves the DB, logo files and staging files untouched: size check → `JSON.parse` → `upgradeExport` (pure) → `exportFileSchema.safeParse` → pure consistency check → manual-logo byte check → automatic export to `BACKUP_DIR` → DB transaction → post-commit file cleanup.
- Reasons: `file-missing`, `file-too-large` (> `RESTORE_MAX_FILE_BYTES` = 50 MB), `not-json`, `version-unsupported` (`schemaVersion` newer than `EXPORT_SCHEMA_VERSION`), `schema-invalid`, `inconsistent`, `logo-invalid`, `backup-failed`, `restore-failed`; `detail` is a path such as `transactions.3.depotId` — never a value.
- Upgrades: `UPGRADES[n]` maps a version-`n` document to version `n+1`; an older file runs through the chain until it reaches `EXPORT_SCHEMA_VERSION`. Today the map is empty (only v1 exists); a missing or non-integer `schemaVersion` < 1 is `schema-invalid`.
- Consistency (pure): ids unique per record kind; every foreign key resolves (transaction depot/security, corporate-action securities, run depot, row `runId` equals its parent run's id, row/mapping/price/logo security); the DB unique keys hold (depot name, ISIN, crypto symbol, `(depotId,date,sequence)`, `(securityId,type,date)`, one mapping/logo per security, `(securityId,date,source)` per price, `(runId,securityId)` per row).
- Logo check: base64-decoded bytes non-empty, ≤ `UPLOAD_MAX_BYTES`, `sniffImage` content type equals the record's `contentType`, `securityId` matches `[A-Za-z0-9_-]+`.
- Automatic export: `createExport()` of the current data, `serializeExport`, written with flag `wx` to `<BACKUP_DIR>/exportFileName(now)`; empty `BACKUP_DIR` means `~/.depotmanagement/backups`; the directory is created if missing. The success result returns this file name.
- One interactive transaction (timeout like `EXPORT_TIMEOUT_MS`): import `clearImportStaging` → news `clearNews` → `ledger.replaceAll` → `prices.replaceAll` → `logos.replaceAll`. Each `replaceAll` deletes all of its module's rows, then inserts the given rows with ids, `sequence`s, decimals, dates and timestamps exactly as in the file; no duplicate matching, no sequence assignment, no `ensureSecurity`.
- Files: `logos.replaceAll` writes the new logo files inside the transaction step and returns handles; on rollback the backup discards the new files; after commit it deletes the previous logo files (manual and fetched) and the cleared batches' PDF directories. A cleanup failure is only a data-free `console.warn`.
- Restore never merges: after success the DB holds exactly the file's rows, and no import batch, news row or fetched logo remains.
- Server action: session check first (`unauthorized`), revalidates `/` layout on success. UI German, touch targets ≥ 44 px, never optimistic.
- Logs carry reason codes, paths and counts only — never amounts, file content or ids.

**Never:**
- Merge, partially restore, or write anything before validation and the automatic export succeed.
- Call any other ledger write service (`recordBatch`, `recordTransaction`, …) or run `core/duplicates`.
- Add a Prisma migration, implement the daily DB backup or its rotation (6.3), or touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Round trip | Full ledger (6.1 seed + prices on several dates), export, restore into an empty DB | Second export byte-identical; `listDepots` cash balances, `listPositions`, `depotValuation` and `portfolioValuation` (MAX, `storedPriceHistory`) deep-equal the originals | No error expected |
| Replace, not merge | Target has other depots, transactions, an OPEN import batch with PDF, news, a fetched logo file | Only the file's rows remain; batch dir, news, fetched logo row and file gone; pre-restore export file in `BACKUP_DIR` | No error expected |
| Not JSON / wrong shape | `"abc"`, `{}`, extra key, `amount: 12.5` | Nothing changes, no backup file | `not-json` / `schema-invalid` with path |
| Newer version | `schemaVersion: 2` | Nothing changes | `version-unsupported` |
| Older version | `upgradeExport` with injected `{ 1: v1→v2 }` and target 2 on a v1 file | Returns the v2 document; the step ran once | — |
| Dangling reference / duplicate key | Transaction with unknown `depotId`; two depots with the same name | Nothing changes | `inconsistent` with path |
| Bad logo | `data` is JPEG bytes but `contentType: image/png` | Nothing changes | `logo-invalid` |
| Backup unwritable | `BACKUP_DIR` is a file | Nothing changes | `backup-failed` |
| DB failure mid-transaction | Injected failure in `prices.replaceAll` | Old data intact, new logo files removed | `restore-failed`, name-only log |
| No session | Action without session | Nothing read or changed | `unauthorized` |

</intent-contract>

## Code Map

- `src/modules/backup/{export,schema,index}.ts` -- `createExport`, `serializeExport`, `exportFileName`, `exportFileSchema`, `EXPORT_SCHEMA_VERSION`, `inTransaction` pattern with `{ timeout, maxWait }`; `ExportFile` record types are the `replaceAll` input shapes.
- `src/modules/ledger/export.ts`, `src/modules/prices/export.ts`, `src/modules/logos/export.ts` -- the exported shapes; `replaceAll` is their inverse (put it next to them, e.g. `restore.ts`).
- `prisma/schema.prisma` -- FK behaviour: Transaction→Security, CorporateAction→Security, ReconciliationRow→Security are `Restrict` (delete transactions, corporate actions, rows before securities); Security deletion cascades to ProviderMapping, Price, SecurityLogo, News; Depot deletion cascades to ImportBatch, ReconciliationRun. SecurityLogo has `provider` (null for MANUAL).
- `src/modules/logos/storage.ts` -- `logosDir`, `writeLogoFile(dir, securityId, image, epochMs)`, `deleteLogoFile`, `LOGO_FILE_NAME`; `src/modules/logos/image.ts` -- `sniffImage`, `LOGO_CONTENT_TYPES`, `UPLOAD_MAX_BYTES`; `logos.ts:220` `saveManualLogo` shows the write-file-then-row, delete-on-failure pattern.
- `src/modules/import/storage.ts` -- `importsDir`, `deleteBatchDir`; `src/modules/import/batches.ts` `discardImportBatch*` for how staging rows/dirs are removed; `ImportDb` type.
- `src/modules/news/news.ts` -- `NewsDb`; add `clearNews`.
- `src/modules/*/index.ts` -- add the new exports; `backup` imports only these entry points.
- `src/app/_actions/logos.ts`, `src/app/_actions/migration.ts` -- server-action upload pattern (session first, size check before reading, `revalidatePath("/", "layout")`).
- `src/app/_components/backup/ExportButton.tsx`, `src/app/_components/securities/LogoUploadDialog.tsx`, `src/app/_components/import/DiscardBatchButton.tsx` -- button, file-picker and dialog patterns; `ACTION_FAILED_MESSAGE` and "Sitzung abgelaufen. Bitte erneut anmelden." wording in `src/app/_components/import/labels.ts`.
- `src/app/(app)/settings/page.tsx` + `page.test.tsx` -- "Datensicherung" section.
- `next.config.ts` -- `serverActions.bodySizeLimit` is 25 mb; Next 16's `experimental.proxyClientMaxBodySize` defaults to 10 MB and truncates larger bodies because `src/proxy.ts` matches every route.
- `src/modules/backup/export.test.ts` -- `seedFullLedger`, temp `DATA_DIR`, `createTestDatabase()` (use two DBs for the round trip).
- `src/modules/prices/prices.ts:364` `storedPriceHistory`, `latestStoredPrices`; `src/modules/ledger/valuation.ts:79,114`, `positions.ts:82`, `depots.ts:222` -- evaluation entry points for the round-trip comparison.
- `README.md` "Data export" section and `.env.example` `BACKUP_DIR` comment.

## Tasks & Acceptance

**Execution:**
- `src/modules/ledger/restore.ts` (+ `index.ts`) -- `replaceAllLedger(data, db)`: delete rows, runs, corporate actions, transactions, depots, securities; `createMany` depots, securities, transactions, corporate actions, runs, rows.
- `src/modules/prices/restore.ts` (+ `index.ts`) -- `replaceAllPrices({ providerMappings, prices }, db)`.
- `src/modules/logos/restore.ts` (+ `index.ts`) -- `checkManualLogos(logos)` → `{ ok: true } | { ok: false, index }`; `replaceAllLogos(logos, deps, db)` reads previous file names, deletes all rows, writes files (`deps.now` epoch), creates MANUAL rows (`provider: null`), returns `{ discardWritten(), removePrevious() }`.
- `src/modules/import/batches.ts` or new file (+ `index.ts`) -- `clearImportStaging(db, deps?)` deletes all items and batches, returns `{ removeFiles() }` for their batch dirs.
- `src/modules/news/news.ts` (+ `index.ts`) -- `clearNews(db)` deletes NewsArticle and NewsFetch.
- `src/modules/backup/upgrade.ts` -- `UPGRADES` (empty) and pure `upgradeExport(raw, upgrades = UPGRADES, target = EXPORT_SCHEMA_VERSION)`.
- `src/modules/backup/consistency.ts` -- pure `checkConsistency(file: ExportFile)` → `{ ok: true } | { ok: false, path }`.
- `src/modules/backup/restore.ts` (+ `index.ts`) -- `RESTORE_MAX_FILE_BYTES`, `backupDir(env)`, `restoreExport(text, deps?, db?)` running the pipeline; `deps` = `{ env, now }`; returns `{ ok: true, backupFileName } | { ok: false, reason, detail? }`; unexpected DB errors → `restore-failed` after rollback and `discardWritten()`.
- `src/app/_actions/backup.ts` -- `restoreAction(_prev, formData)`: session → file (`file-missing` / `file-too-large` before reading) → `restoreExport(await file.text())` → revalidate on success.
- `src/app/_components/backup/RestoreButton.tsx` (+ `labels.ts` if useful) -- outlined "Wiederherstellen" button (restore icon) opening one dialog "Daten wiederherstellen": text "Alle Daten werden durch den Inhalt der Datei ersetzt. Vorher wird automatisch ein Export der aktuellen Daten im Sicherungsordner abgelegt.", file picker "Exportdatei wählen" (`accept=".json,application/json"`, shows the chosen name), text field "Zur Bestätigung WIEDERHERSTELLEN eingeben"; error-colored submit "Wiederherstellen" enabled only with a file and the exact text; Enter submits, Esc/"Abbrechen" closes; pending disables all; submit via `onSubmit` + `startTransition` so file and text survive an error; error → Alert in the dialog with a German message per reason (with `detail` for `schema-invalid`/`inconsistent`), thrown action → `ACTION_FAILED_MESSAGE`; success → dialog closes and a success Alert below the buttons: "Daten wiederhergestellt. Automatischer Export: <file name>".
- `src/app/(app)/settings/page.tsx` -- add `RestoreButton` beside `ExportButton`; extend the section sentence to mention restoring.
- `next.config.ts` -- `serverActions.bodySizeLimit: "60mb"` and `experimental.proxyClientMaxBodySize: "60mb"` with a comment.
- `README.md` + `.env.example` -- "Restore" subsection (what is replaced, automatic export to `BACKUP_DIR`, default dir, size limit, schema upgrades, local → production via export/restore); `BACKUP_DIR` comment mentions pre-restore exports.
- Tests: `src/modules/backup/restore.test.ts` (every matrix row; round-trip test compares bytes and evaluations; nothing-changed assertions compare a full export and the logo/imports dirs before and after; no backup file on validation failures), `upgrade.test.ts`, `consistency.test.ts` (each rule), `src/app/_actions/backup.test.ts` (unauthorized, file-missing, too large, success revalidates), `src/app/_components/backup/RestoreButton.dom.test.tsx` (disabled until file + exact text, error Alert keeps the chosen file and text, success Alert with name, thrown action message), settings page test (section contains `RestoreButton`).

**Acceptance Criteria:**
- Given an export file, when Tommy chooses "Wiederherstellen" in Settings, selects the file and types "WIEDERHERSTELLEN", then all data is replaced by the file's content and a success message names the automatic export written to `BACKUP_DIR` beforehand.
- Given an invalid or newer-version file, when he confirms the restore, then the dialog shows a German reason and no data, logo file or staging file has changed.
- Given the confirm text is not exactly "WIEDERHERSTELLEN" or no file is chosen, when he looks at the dialog, then the restore button is disabled.
- Given the README, when a reader looks for restoring or moving data to production, then a section explains export → restore and the automatic pre-restore export.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 24 findings — high 0, medium 0, low 21, false 1, maybe-false 2
- findings:
  - `[low]` `[reject]` Blind: background price/news/logo jobs are not locked out during a restore (writes between the automatic export and the transaction are missing from the undo file; a stale job may write after commit) — real but the window is milliseconds in a single-user app with daily jobs; a cross-module lock adds machinery no AC asks for; transactions are serialized by the adapter.
  - `[low]` `[reject]` Blind: consistency check accepts semantically broken records (BUY without security, ratio "0", ISIN change to itself) — only reachable with a hand-edited file; app exports always satisfy AD-14; fix adds a rule set; the automatic export allows undo.
  - `[low]` `[patch]` Blind: the pre-restore export is written with default permissions — fixed: `writeFileSync(..., { flag: "wx", mode: 0o600 })`, plus a mode test.
  - `[false]` `[reject]` Blind: `inTransaction` fallback drops atomicity — the fallback runs only when `db` is already an interactive-transaction client, i.e. inside the caller's atomic transaction (same rejection as in 6-1).
  - `[low]` `[reject]` Blind: no client-side size check, a > 60 MB file shows the generic connection error — files between 50 and 60 MB get the German size message from the server; > 60 MB exports are not expected for one user; fix adds a guard.
  - `[low]` `[reject]` Blind: two restores within the same second fail with `backup-failed` (`wx`) — needs two confirmed restores within one second; the message states nothing changed and a retry succeeds; fix adds a suffix loop.
  - `[low]` `[reject]` Blind: undo needs the server's `BACKUP_DIR`, the UI shows only the file name — the README names the directory and the single maintainer has shell access; a download link is new surface no AC asks for.
  - `[maybe-false]` `[reject]` Blind: 6.3 rotation could prune pre-restore exports in the shared `BACKUP_DIR` — the epic defines rotation over `depot-<YYYY-MM-DD>.sqlite` only; would be settled in 6.3 and would only be low.
  - `[low]` `[patch]` Blind: a UTF-8 BOM makes a valid file fail as `not-json` — fixed: one leading `\uFEFF` is stripped before parsing; BOM round-trip test added.
  - `[low]` `[reject]` Blind: an empty chosen file shows "Bitte eine Exportdatei wählen." — cosmetic, unlikely, a distinct reason adds surface.
  - `[low]` `[patch]` Blind: the "50 MB" text is hard-coded in `labels.ts` — fixed: built from `RESTORE_MAX_FILE_BYTES`.
  - `[low]` `[reject]` Blind: `busy` is set in an effect, so Esc in the commit before it runs closes the dialog — the window is one React commit after the click; the guarded path is covered by the new Esc-while-pending test; a synchronous ref adds complexity.
  - `[low]` `[reject]` Blind: test gaps (older version end to end, commit failure, weak settings text check) — the upgrade chain is empty and tested in isolation; the settings test asserts `RestoreButton` is rendered in the section.
  - `[low]` `[reject]` Blind: a throwing upgrade step returns `schema-invalid` without detail or log — no upgrade step exists yet; belongs to the first real upgrade.
  - `[low]` `[reject]` Edge: no client-side size check before upload — same claim as Blind row 5.
  - `[low]` `[reject]` Edge: a pre-restore export > 50 MB could not be restored later — current data can only exceed the limit by growing past it; unlikely for one user's portfolio.
  - `[low]` `[reject]` Edge: same-second `wx` collision — same claim as Blind row 6.
  - `[low]` `[reject]` Edge: a disk-full write leaves a truncated automatic export — restore then reports `backup-failed` and changes nothing; unlikely; fix adds cleanup branches.
  - `[low]` `[reject]` Edge: concurrent writers around the auto-export and commit — same claim as Blind row 1.
  - `[maybe-false]` `[reject]` Edge: a logo file written by another process after the directory listing is never deleted — would need a fetch job writing a file inside the restore's transaction window; at worst an orphan file (low).
  - `[low]` `[patch]` Verification gap: no test presses Esc while a restore is pending — fixed: the pending test presses `{Escape}` and asserts the dialog stays open.
  - `[low]` `[patch]` Verification gap: the `securityId` file-name check in `checkManualLogos` is never exercised — fixed: rejection test with `sec.b` expecting `logo-invalid` at `logos.0`, nothing changed, no backup file.
  - `[low]` `[defer]` Verification gap: the epoch-bump guard against overwriting an existing logo file is untested — deferred (collision needs the same millisecond epoch).
  - `[low]` `[reject]` Intent: no single test drives Settings → dialog → action → DB — each surface is tested (DOM test against the action contract, action test against the real module and DB, module round trip); the diff implements the agent-completable reading with no operator actions.

## Design Notes

Validation happens once, in `backup`, before any write: the export schema is the contract and lives there, so `replaceAll*` take typed, already-validated records; DB constraints (FK, unique) are the backstop and turn into `restore-failed` with a rollback.

`replaceAll` call order relies on the cascades listed in the Code Map: deleting Securities in `replaceAllLedger` already removes mappings, prices and logo rows, so `replaceAllPrices`/`replaceAllLogos` delete explicitly anyway (idempotent) and then insert after the Securities exist.

Files cannot join the DB transaction: new logo files are written before the rows are committed and removed on rollback; old logo files and staging PDFs are deleted only after commit, so a failed restore leaves every file in place.

Upgrade sketch (pure):
```ts
export function upgradeExport(raw: unknown, upgrades = UPGRADES, target = EXPORT_SCHEMA_VERSION): UpgradeResult {
  // read raw.schemaVersion; > target → version-unsupported; non-integer/< 1 or no upgrade step → schema-invalid
  // while (version < target) raw = upgrades[version](raw), version += 1
}
```

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Settings → "Datensicherung" has a "Wiederherstellen" button opening the destructive dialog "Daten wiederherstellen" (export file + typed "WIEDERHERSTELLEN"). `restoreAction` (session-checked) calls `backup.restoreExport`, which checks size, JSON, `schemaVersion` (pure upgrade chain, empty while only v1 exists), the strict export schema, referential/unique-key consistency and logo bytes before anything is written; then writes an automatic export of the current data to `BACKUP_DIR` (default `~/.depotmanagement/backups`, mode 0600, never overwriting) and replaces all data in one transaction: clear import staging and news, `replaceAllLedger`, `replaceAllPrices`, `replaceAllLogos` (ids, sequences, decimals, timestamps verbatim; no duplicate matching). New logo files are discarded on rollback; old logo files and staging PDFs are deleted after commit. Every rejection returns a typed reason (German Alert, field path for schema/consistency errors) and leaves data and files unchanged. Server-action and proxy body limits raised to 60 MB (restore limit 50 MB). README documents restore and local → production moves.

**Files changed:**
- `src/modules/backup/{restore,upgrade,consistency,limits,index}.ts` — restore pipeline, pure upgrades, pure consistency check, size limit.
- `src/modules/ledger/restore.ts`, `src/modules/prices/restore.ts`, `src/modules/logos/restore.ts` (+ `index.ts`) — per-module `replaceAll*` writers; logo byte check and file handles.
- `src/modules/import/batches.ts`, `src/modules/news/news.ts` (+ `index.ts`) — `clearImportStaging`, `clearNews`.
- `src/app/_actions/backup.ts` — `restoreAction`.
- `src/app/_components/backup/RestoreButton.tsx`, `labels.ts` — dialog and German texts.
- `src/app/(app)/settings/page.tsx` — restore button in "Datensicherung".
- `next.config.ts` — `serverActions.bodySizeLimit` and `experimental.proxyClientMaxBodySize` 60 MB.
- `README.md`, `.env.example` — Restore section, `BACKUP_DIR` comment.
- Tests: `src/modules/backup/{restore,upgrade,consistency}.test.ts`, `src/app/_actions/backup.test.ts`, `RestoreButton.dom.test.tsx`, settings page test, `test/architecture/next-config.test.ts`, shared seed `test/helpers/backup-seed.ts` (used by `export.test.ts`).

**Deviation from the spec text:** `replaceAllLogos` lists the files in `<DATA_DIR>/logos` instead of reading previous rows, because the ledger step's Security deletion already cascaded the logo rows away in the same transaction; after commit every previous logo file (also orphans) is deleted.

**Review findings:** one pass, 24 findings (high 0, medium 0, low 21, false 1, maybe-false 2). 5 patches applied (all low: export file mode 0600, BOM stripping, size text from the constant, Esc-while-pending test, logo `securityId` rejection test); 1 deferred (untested epoch-bump guard, low). Every rejected finding and its reason is in the Review Triage Log above.

**Follow-up review recommended:** false — patched 0 high, 0 medium, 5 low.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (178 test files, 2462 tests). Every I/O matrix row is covered by a passing test (round trip with byte-identical export and deep-equal `listDepots`/`listPositions`/`depotValuation`/`portfolioValuation`; replace-not-merge; each rejection reason with before/after snapshots of DB and files; DB failures injected via SQLite triggers; upgrade chain with injected step; unauthorized action).

**Residual risks:** a 50 MB upload was not tried against a running server (only config values are tested; 6.4's Nginx needs a matching `client_max_body_size`); background jobs are not paused during a restore; the automatic export stays in `BACKUP_DIR` when the transaction later fails (harmless); semantic AD-14 checks of hand-edited files are not performed.
