// Restore from a JSON export (story 6.2, AD-12): replace, never merge. The pipeline validates the whole
// file before anything is written, then writes an automatic export of the current data to `BACKUP_DIR`,
// then replaces all data in one interactive transaction through the owning modules' restore writers.
// Files cannot join the transaction: new logo files are discarded on rollback, previous logo files and
// cleared import PDFs are deleted only after the commit. Logs carry reason codes and error names only.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { prisma } from "@/db";
import { replaceAllClassifications } from "@/modules/classification";
import { clearImportStaging } from "@/modules/import";
import { replaceAllLedger } from "@/modules/ledger";
import { checkManualLogos, type LogoRestoreFiles, replaceAllLogos } from "@/modules/logos";
import { clearNews } from "@/modules/news";
import { replaceAllPrices } from "@/modules/prices";
import { checkConsistency } from "./consistency";
import { type BackupDb, createExport, EXPORT_TIMEOUT_MS, exportFileName, serializeExport } from "./export";
import { RESTORE_MAX_FILE_BYTES } from "./limits";
import { exportFileSchema } from "./schema";
import { upgradeExport } from "./upgrade";

export { RESTORE_MAX_FILE_BYTES } from "./limits";

export type RestoreFailureReason =
  | "file-missing"
  | "file-too-large"
  | "not-json"
  | "version-unsupported"
  | "schema-invalid"
  | "inconsistent"
  | "logo-invalid"
  | "backup-failed"
  | "restore-failed";

/** `detail` is a field path such as `transactions.3.depotId`, never a value. */
export type RestoreResult = { ok: true; backupFileName: string } | { ok: false; reason: RestoreFailureReason; detail?: string };

export type RestoreDeps = {
  env?: { BACKUP_DIR?: string; DATA_DIR?: string };
  /** Current time for the automatic export's file name and the logo file names. */
  now?: () => Date;
};

/** The backup directory: `BACKUP_DIR`; empty means `~/.depotmanagement/backups`. */
export function backupDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env.BACKUP_DIR?.trim();
  return configured ? resolve(configured) : join(homedir(), ".depotmanagement", "backups");
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/** A validation failure: logged with its code and path, nothing has been written. */
function fail(reason: RestoreFailureReason, detail?: string): RestoreResult {
  console.warn(`Restore: rejected (${reason}${detail ? ` at ${detail}` : ""})`);
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

async function inTransaction<T>(db: BackupDb, write: (tx: BackupDb) => Promise<T>): Promise<T> {
  const client = db as BackupDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") {
    return client.$transaction((tx) => write(tx), { timeout: EXPORT_TIMEOUT_MS, maxWait: 10_000 });
  }
  return write(db);
}

/** Writes an export of the current data to `BACKUP_DIR` (never overwriting a file); returns its name. */
async function writeAutomaticExport(deps: RestoreDeps, now: Date, db: BackupDb): Promise<string> {
  const text = serializeExport(await createExport({ env: deps.env }, db));
  const dir = backupDir(deps.env ?? process.env);
  mkdirSync(dir, { recursive: true });
  const fileName = exportFileName(now);
  writeFileSync(join(dir, fileName), text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return fileName;
}

/**
 * Replaces all data with the export document in `text`. Every expected failure returns a typed result
 * and leaves the database, logo files and import files untouched.
 */
export async function restoreExport(input: string, deps: RestoreDeps = {}, db: BackupDb = prisma): Promise<RestoreResult> {
  if (Buffer.byteLength(input, "utf8") > RESTORE_MAX_FILE_BYTES) return fail("file-too-large");
  // Editors may save a UTF-8 byte order mark, which JSON.parse rejects.
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  if (text.trim() === "") return fail("file-missing");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("not-json");
  }
  const upgraded = upgradeExport(raw);
  if (!upgraded.ok) return fail(upgraded.reason, upgraded.detail);
  const parsed = exportFileSchema.safeParse(upgraded.document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Unknown keys are reported on their parent; name the key itself.
    const path = [...(issue?.path ?? []), ...(issue?.code === "unrecognized_keys" ? issue.keys.slice(0, 1) : [])];
    return fail("schema-invalid", path.map(String).join("."));
  }
  const file = parsed.data;
  const consistent = checkConsistency(file);
  if (!consistent.ok) return fail("inconsistent", consistent.path);
  const logosChecked = checkManualLogos(file.logos);
  if (!logosChecked.ok) return fail("logo-invalid", `logos.${logosChecked.index}`);

  const now = (deps.now ?? (() => new Date()))();
  let backupFileName: string;
  try {
    backupFileName = await writeAutomaticExport(deps, now, db);
  } catch (error) {
    console.error(`Restore: the automatic export failed (${errorName(error)})`);
    return { ok: false, reason: "backup-failed" };
  }

  let logoFiles: LogoRestoreFiles | undefined;
  let stagingFiles: { removeFiles: () => void };
  try {
    stagingFiles = await inTransaction(db, async (tx) => {
      const staging = await clearImportStaging(tx, { env: deps.env });
      await clearNews(tx);
      await replaceAllLedger(file, tx);
      await replaceAllPrices(file, tx);
      logoFiles = await replaceAllLogos(file.logos, { env: deps.env, now: () => now }, tx);
      await replaceAllClassifications(file.classifications, tx, () => now);
      return staging;
    });
  } catch (error) {
    logoFiles?.discardWritten();
    console.error(`Restore: replacing the data failed (${errorName(error)})`);
    return { ok: false, reason: "restore-failed" };
  }

  // Committed: the previous logo files and the cleared batches' PDFs are no longer referenced.
  try {
    logoFiles?.removePrevious();
    stagingFiles.removeFiles();
  } catch (error) {
    console.warn(`Restore: removing old files failed (${errorName(error)})`);
  }
  console.info(
    `Restore: replaced all data (${file.depots.length} depots, ${file.transactions.length} transactions, ${file.prices.length} prices, ${file.logos.length} logos, ${file.classifications.length} classifications)`,
  );
  return { ok: true, backupFileName };
}
