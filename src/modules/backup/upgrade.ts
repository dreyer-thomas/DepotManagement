// Export schema upgrades (story 6.2, AD-12): pure functions that lift an export document one
// `schemaVersion` at a time until it reaches the current version. The result is validated afterwards.
import { EXPORT_SCHEMA_VERSION } from "./schema";

/** One upgrade step: maps a version-`n` document to version `n + 1`. */
export type ExportUpgrade = (document: Record<string, unknown>) => Record<string, unknown>;

/** `UPGRADES[n]` upgrades version `n` to `n + 1`. */
export const UPGRADES: Readonly<Record<number, ExportUpgrade>> = {
  // Version 2 (story 7.1) adds manual classification overrides; a version-1 export has none.
  1: (document) => ({ ...document, schemaVersion: 2, classifications: [] }),
  // Version 3 (story 8.3) adds the tax settings; a version-2 export has none.
  2: (document) => ({ ...document, schemaVersion: 3, taxAllowances: [], teilfreistellungOverrides: [] }),
};

export type UpgradeResult =
  | { ok: true; document: unknown }
  | { ok: false; reason: "version-unsupported" | "schema-invalid"; detail?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Upgrades a parsed export document to `target`. A version newer than `target` is unsupported; a
 * missing, non-integer or < 1 version, a missing step or a throwing step is `schema-invalid`.
 */
export function upgradeExport(
  raw: unknown,
  upgrades: Readonly<Record<number, ExportUpgrade>> = UPGRADES,
  target: number = EXPORT_SCHEMA_VERSION,
): UpgradeResult {
  if (!isRecord(raw)) return { ok: false, reason: "schema-invalid" };
  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: "schema-invalid", detail: "schemaVersion" };
  }
  if (version > target) return { ok: false, reason: "version-unsupported" };
  let document = raw;
  for (let current = version; current < target; current += 1) {
    const step = Object.hasOwn(upgrades, current) ? upgrades[current] : undefined;
    if (!step) return { ok: false, reason: "schema-invalid", detail: "schemaVersion" };
    try {
      document = step(document);
    } catch {
      return { ok: false, reason: "schema-invalid" };
    }
    if (!isRecord(document)) return { ok: false, reason: "schema-invalid" };
  }
  return { ok: true, document };
}
