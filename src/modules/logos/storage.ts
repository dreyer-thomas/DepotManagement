// Logo files under `<DATA_DIR>/logos` (owned by the logos module). File names are generated here and
// re-validated whenever one is read from the database, so a stored name can never escape the directory.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { LogoImage } from "./image";

/** Allowed logo file names: `<securityId>-<epochMs>.<png|jpg|webp>`. */
export const LOGO_FILE_NAME = /^[A-Za-z0-9_-]+\.(png|jpg|webp)$/;

/** Default data directory: outside the source tree, in the user's home directory. */
export function defaultDataDir(): string {
  return join(homedir(), ".depotmanagement", "data");
}

/** The logo directory: `<DATA_DIR>/logos`; an empty `DATA_DIR` means `~/.depotmanagement/data`. */
export function logosDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DATA_DIR?.trim();
  return join(configured ? resolve(configured) : defaultDataDir(), "logos");
}

/** True when `fileName` is a valid logo file name (no path separators, no traversal). */
export function isLogoFileName(fileName: string): boolean {
  return LOGO_FILE_NAME.test(fileName);
}

/** Writes `image` as `<securityId>-<epochMs>.<ext>` into `dir` and returns the file name. */
export function writeLogoFile(dir: string, securityId: string, image: LogoImage, epochMs: number): string {
  const fileName = `${securityId}-${epochMs}.${image.extension}`;
  if (!isLogoFileName(fileName)) throw new Error("invalid logo file name");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), image.bytes);
  return fileName;
}

/** Deletes a logo file; invalid names and missing files are ignored. */
export function deleteLogoFile(dir: string, fileName: string | null | undefined): void {
  if (!fileName || !isLogoFileName(fileName)) return;
  try {
    rmSync(join(dir, fileName), { force: true });
  } catch (error) {
    console.warn(`Logos: deleting a file failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}

/** The bytes of a logo file, or `null` when the name is invalid or the file is missing. */
export function readLogoFile(dir: string, fileName: string): Buffer | null {
  if (!isLogoFileName(fileName)) return null;
  try {
    return readFileSync(join(dir, fileName));
  } catch {
    return null;
  }
}
