// The backup module owns the JSON export/restore, export schema upgrades and the daily DB file backup
// with its in-process scheduler and status (story 6.3). It reaches other modules only through their
// entry points (`ledger`, `prices`, `logos`, `classification`, `tax`, and for the restore's cache clearing `import` and `news`).
export { createExport, EXPORT_TIMEOUT_MS, exportFileName, serializeExport } from "./export";
export type { BackupDb, ExportDeps } from "./export";
export { EXPORT_SCHEMA_VERSION, exportFileSchema } from "./schema";
export type { ExportFile } from "./schema";
export { backupDir, RESTORE_MAX_FILE_BYTES, restoreExport } from "./restore";
export type { RestoreDeps, RestoreFailureReason, RestoreResult } from "./restore";
export { UPGRADES, upgradeExport } from "./upgrade";
export type { ExportUpgrade, UpgradeResult } from "./upgrade";
export { checkConsistency } from "./consistency";
export type { ConsistencyResult } from "./consistency";
export {
  BACKUP_CHECK_INTERVAL_MS,
  backupKeep,
  backupStatus,
  DEFAULT_BACKUP_KEEP,
  dbBackupFileName,
  runDatabaseBackup,
  startBackupScheduler,
  stopBackupScheduler,
} from "./db-backup";
export type { BackupSchedulerDeps, BackupStatus, DbBackupDeps, DbBackupResult } from "./db-backup";
