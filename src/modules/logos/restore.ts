// Restore of manually uploaded logos (story 6.2): the inverse of `exportManualLogos`. Files cannot join
// the DB transaction, so new files are written inside the transaction step and the caller decides what
// to delete: the new files on rollback, the previous files (manual and fetched) after commit.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ManualLogoExport } from "./export";
import { sniffImage, UPLOAD_MAX_BYTES } from "./image";
import type { LogoDeps, LogosDb } from "./logos";
import { deleteLogoFile, isLogoFileName, logosDir, writeLogoFile } from "./storage";

const SECURITY_ID = /^[A-Za-z0-9_-]+$/;

function decode(logo: ManualLogoExport): Uint8Array {
  return new Uint8Array(Buffer.from(logo.data, "base64"));
}

/**
 * Checks the bytes of every logo before anything is written: non-empty, at most `UPLOAD_MAX_BYTES`,
 * magic bytes matching `contentType`, and a `securityId` usable in a file name.
 */
export function checkManualLogos(logos: readonly ManualLogoExport[]): { ok: true } | { ok: false; index: number } {
  for (const [index, logo] of logos.entries()) {
    if (!SECURITY_ID.test(logo.securityId)) return { ok: false, index };
    const bytes = decode(logo);
    if (bytes.byteLength === 0 || bytes.byteLength > UPLOAD_MAX_BYTES) return { ok: false, index };
    if (sniffImage(bytes)?.contentType !== logo.contentType) return { ok: false, index };
  }
  return { ok: true };
}

function listLogoFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter(isLogoFileName);
  } catch {
    return [];
  }
}

/** File handles of a logo restore: what to delete after a rollback or after the commit. */
export type LogoRestoreFiles = {
  /** Deletes the files this restore wrote (call after a rollback). */
  discardWritten(): void;
  /** Deletes the files of the rows this restore replaced (call after the commit). */
  removePrevious(): void;
};

/**
 * Deletes every SecurityLogo row (manual, fetched, markers), writes each given logo as a new file and
 * creates its MANUAL row (`provider: null`) with id and `fetchedAt` as given. `removePrevious()` deletes
 * every logo file that was in the directory before (manual and fetched). Expects `checkManualLogos`
 * to have passed. On a failure here the written files are deleted before the error is rethrown.
 */
export async function replaceAllLogos(
  logos: readonly ManualLogoExport[],
  deps: Pick<LogoDeps, "env" | "now">,
  db: LogosDb,
): Promise<LogoRestoreFiles> {
  const dir = logosDir(deps.env ?? process.env);
  const epochMs = (deps.now ?? (() => new Date()))().getTime();
  // Every logo file present now: once the replaced rows are committed, none of them is referenced any
  // more. The directory is listed instead of the rows because the ledger restore before this step has
  // already cascaded the previous rows away inside the same transaction.
  const previous = new Set(listLogoFiles(dir));
  const written: string[] = [];
  const discardWritten = () => {
    for (const fileName of written) deleteLogoFile(dir, fileName);
  };
  try {
    await db.securityLogo.deleteMany();
    const rows = logos.map((logo) => {
      const bytes = decode(logo);
      const format = sniffImage(bytes);
      if (!format || format.contentType !== logo.contentType) throw new Error("invalid logo");
      // Never overwrite an existing file (a previous logo must survive a rollback).
      let epoch = epochMs;
      while (existsSync(join(dir, `${logo.securityId}-${epoch}.${format.extension}`))) epoch += 1;
      const fileName = writeLogoFile(dir, logo.securityId, { ...format, bytes }, epoch);
      written.push(fileName);
      return {
        id: logo.id,
        securityId: logo.securityId,
        source: "MANUAL" as const,
        provider: null,
        fileName,
        contentType: logo.contentType,
        fetchedAt: logo.fetchedAt,
      };
    });
    if (rows.length > 0) await db.securityLogo.createMany({ data: rows });
  } catch (error) {
    discardWritten();
    throw error;
  }
  const kept = new Set(written);
  return {
    discardWritten,
    removePrevious: () => {
      for (const fileName of previous) if (!kept.has(fileName)) deleteLogoFile(dir, fileName);
    },
  };
}
