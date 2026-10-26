# Epic 6 Context: Data Safety & Operations

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy's data must never be locked in or lost. He can export everything to one open, versioned JSON file and restore from it (replace, never merge). The app also takes a daily SQLite backup on its own. DepotManagement then moves from his local machine to his Linux server behind Nginx with TLS, using a simple documented setup. Local data reaches production by export → restore. This epic makes the app safe to depend on as his only portfolio tracker.

## Stories

- Story 6.1: Export All Data
- Story 6.2: Restore from Export
- Story 6.3: Daily Database Backup
- Story 6.4: Production Deployment behind Nginx

## Requirements & Constraints

- Round-trip guarantee: export, then restore into an empty instance, then export again must yield identical files. Every evaluation must also match: values, Cost Basis, Gain/Loss, TTWROR, XIRR, Cash Account balances. An automated test must cover this.
- **Export content:** Depots, Securities, ProviderMappings, Transactions (including ADJUSTMENT rows and notes), CorporateActions, ReconciliationRuns with their rows, all stored Prices (manual and fetched) and manually uploaded logos as base64.
- **Not exported:** caches, import staging, news and fetched logos.
- Export format: decimals and dates are strings exactly as stored, and IDs and intra-day sequences are kept. The file carries a `schemaVersion`. File name: `depotmanagement-export-<YYYYMMDD-HHMMSS>.json`.
- Restore validates the file and rejects an invalid one with a reason, leaving all data unchanged.
  - It upgrades older `schemaVersion`s through pure upgrade functions.
  - Before replacing anything, it writes an automatic export of the current data to `BACKUP_DIR`.
- Daily backup: better-sqlite3 `backup()` (safe under WAL) writes `BACKUP_DIR/depot-<YYYY-MM-DD>.sqlite`. It runs on the daily scheduler and once at startup if today's file is missing. Only the newest `BACKUP_KEEP` files are kept.
- A failed backup is logged and shown as a warning in Settings, together with the time of the last successful backup.
- Privacy and public-repo rules:
  - The README and committed files contain no personal data, credentials or keys.
  - A script or CI check fails when `.env`, SQLite files or Parqet CSVs are tracked by git.
  - Logs never contain per-Transaction amounts, credentials or keys.
- The README documents:
  - the export schema
  - restoring from a DB backup file
  - production deployment
  - moving data from local to production via export/restore

## Technical Decisions

- **`backup` module:** owns JSON export/restore, schema upgrades and the DB file backup. It reaches other modules only through their exported services: `ledger`, `prices` and `logos`. ReconciliationRuns belong to `ledger`. Manual logos and logo files under `DATA_DIR` belong to `logos`.
- **Restore write path:** restore is the one exception to the single ledger write path.
  - In one DB transaction it clears staging and caches, then calls `ledger.replaceAll`, `prices.replaceAll` and the logos equivalent.
  - These functions validate the schema, keep IDs and sequence numbers, and skip duplicate matching.
  - Writing services accept an optional Prisma transaction client so the restore can span modules in one transaction.
- **Validation:** the export/backup file schema is defined with zod at the shell boundary. Expected failures return typed results (`{ ok: false, reason }`) and do not throw.
- **Money and dates:** money, quantity and price stay TEXT decimal strings through export and restore, and are never converted to `number`. Dates stay `YYYY-MM-DD`. Nothing derived is exported; Positions, balances and returns are recomputed by `src/core` after restore.
- **Process and scheduler:** the app runs as exactly one Node process. The scheduler is in-process via `instrumentation.ts`, already running the price jobs from Epic 3 and guarded against double start. The daily backup is added to it.
- **Configuration:** fixed environment variable names:
  - `DATABASE_URL`, `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`
  - `BACKUP_DIR`, `BACKUP_KEEP`, `DATA_DIR`
  - provider keys: `COINGECKO_API_KEY`, `OPENFIGI_API_KEY`, `LOGO_DEV_API_KEY`

  `.env.example` lists them without values. The DB file, `BACKUP_DIR` and `DATA_DIR` live outside the source tree. SQLite runs in WAL mode with a busy timeout.
- **Deployment:**
  - The deploy/start script installs dependencies, runs `prisma migrate deploy`, builds, and runs `next start` on 127.0.0.1. The app never migrates itself, and committed migrations are immutable.
  - Provide an example systemd unit: restart on failure, env file outside the repo, stdout to journald.
  - Provide an example Nginx server block: TLS, proxy to 127.0.0.1, an upload size limit large enough for PDF batches.
  - Login stays required on every page and route except login. Next telemetry stays disabled (`NEXT_TELEMETRY_DISABLED=1`), and no analytics are added.
- **Stack:** Node 24 LTS. Builds need network access because `next/font/google` fetches Roboto at build time.

## UX & Interaction Patterns

- Settings has an export/restore section. "Exportieren" downloads the file.
- "Wiederherstellen" opens a file picker and a destructive confirm dialog. The dialog states that all data will be replaced and that an automatic export is taken first. Tommy must type "WIEDERHERSTELLEN" to enable it.
- Settings shows a backup warning when the last backup failed, with the time of the last successful backup.
- UI text is German, short and factual. Writes are never optimistic. Dialogs are never more than one level deep. Enter submits and Esc closes. A server error keeps the form state and shows an Alert.

## Cross-Story Dependencies

- 6.2 depends on 6.1: restore consumes the 6.1 schema and reuses export for the pre-restore automatic export. 6.4 relies on 6.1 and 6.2 for the local→production data move, and documents 6.3's backup and `BACKUP_DIR`.
- 6.3 extends the Epic 3 in-process scheduler.
- Export must cover every stored model from earlier epics:
  - Depots, Transactions, CorporateActions and Securities from Epics 1–2
  - ADJUSTMENT rows and ReconciliationRuns from Story 2.9
  - ProviderMappings, Prices and manual logos from Epic 3

  Import staging from Epic 5, plus the news and fetched-logo caches, must be cleared on restore and never exported.
