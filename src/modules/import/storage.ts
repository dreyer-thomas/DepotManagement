// Uploaded PDFs under `<DATA_DIR>/imports/<batchId>/<itemId>.pdf` (owned by the import module). Names are
// generated here from Prisma ids and re-validated on every use, so no stored name can escape the directory.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ID = /^[A-Za-z0-9_-]+$/;
const STORED_FILE = /^[A-Za-z0-9_-]+\.pdf$/;

/** The imports directory: `<DATA_DIR>/imports`; an empty `DATA_DIR` means `~/.depotmanagement/data`. */
export function importsDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DATA_DIR?.trim();
  return join(configured ? resolve(configured) : join(homedir(), ".depotmanagement", "data"), "imports");
}

/** True for a generated stored file name (`<itemId>.pdf`; no separators, no traversal). */
export function isStoredFileName(fileName: string): boolean {
  return STORED_FILE.test(fileName);
}

function batchDir(dir: string, batchId: string): string {
  if (!ID.test(batchId)) throw new Error("invalid import batch id");
  return join(dir, batchId);
}

/** Writes `bytes` as `<itemId>.pdf` into the batch directory and returns the file name. */
export function writeImportFile(dir: string, batchId: string, itemId: string, bytes: Uint8Array): string {
  const fileName = `${itemId}.pdf`;
  if (!isStoredFileName(fileName)) throw new Error("invalid import file name");
  const target = batchDir(dir, batchId);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, fileName), bytes);
  return fileName;
}

/** Deletes a batch directory with its files; an invalid id or a missing directory is ignored. */
export function deleteBatchDir(dir: string, batchId: string): void {
  if (!ID.test(batchId)) return;
  try {
    rmSync(join(dir, batchId), { recursive: true, force: true });
  } catch (error) {
    console.warn(`Import: deleting a batch directory failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}
