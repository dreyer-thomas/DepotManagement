import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Default SQLite location: outside the source tree, in the user's home directory. */
export function defaultDatabasePath(): string {
  return join(homedir(), ".depotmanagement", "depot.db");
}

/**
 * Returns `DATABASE_URL` when it is set and non-empty, otherwise the home-dir default.
 * Ensures the parent directory of a `file:` database exists.
 */
export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DATABASE_URL?.trim();
  const url = configured ? configured : `file:${defaultDatabasePath()}`;
  const path = databaseFilePath(url);
  if (path) mkdirSync(dirname(path), { recursive: true });
  return url;
}

/** Extracts the file path from a `file:` URL (relative paths resolve against the cwd). */
export function databaseFilePath(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined;
  const raw = url.slice("file:".length).split("?")[0];
  if (raw === "" || raw === ":memory:") return undefined;
  return isAbsolute(raw) ? raw : resolve(raw);
}
