// JSON export of all data (story 6.1). Reads every module's export reader inside one interactive
// transaction (no other transaction interleaves; the better-sqlite3 adapter serializes transactions
// only with each other on its one shared connection), assembles the keys in a fixed order and validates the result
// against the export schema before anyone serves it. No timestamp inside the file: the same data
// always yields the same document (export → restore → export round-trip, story 6.2).
import { prisma } from "@/db";
import type { Prisma } from "@/db/generated/prisma/client";
import { exportClassifications } from "@/modules/classification";
import { exportLedgerData } from "@/modules/ledger";
import { exportManualLogos, type LogoDeps } from "@/modules/logos";
import { exportPriceData } from "@/modules/prices";
import { exportTaxSettings } from "@/modules/tax";
import { EXPORT_SCHEMA_VERSION, exportFileSchema, type ExportFile } from "./schema";

export type BackupDb = Prisma.TransactionClient;

export type ExportDeps = Pick<LogoDeps, "env">;

/** Upper bound of the snapshot transaction; logo files are read inside it. */
export const EXPORT_TIMEOUT_MS = 120_000;

async function inTransaction<T>(db: BackupDb, read: (tx: BackupDb) => Promise<T>): Promise<T> {
  const client = db as BackupDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") {
    return client.$transaction((tx) => read(tx), { timeout: EXPORT_TIMEOUT_MS, maxWait: 10_000 });
  }
  return read(db);
}

/** Builds and validates the export document of all stored data (throws only on unexpected failures). */
export async function createExport(deps: ExportDeps = {}, db: BackupDb = prisma): Promise<ExportFile> {
  const file = await inTransaction(db, async (tx) => {
    const ledger = await exportLedgerData(tx);
    const prices = await exportPriceData(tx);
    const logos = await exportManualLogos(deps, tx);
    const classifications = await exportClassifications(tx);
    const tax = await exportTaxSettings(tx);
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      depots: ledger.depots,
      securities: ledger.securities,
      providerMappings: prices.providerMappings,
      transactions: ledger.transactions,
      corporateActions: ledger.corporateActions,
      reconciliationRuns: ledger.reconciliationRuns,
      prices: prices.prices,
      logos,
      classifications,
      taxAllowances: tax.taxAllowances,
      teilfreistellungOverrides: tax.teilfreistellungOverrides,
    };
  });
  const parsed = exportFileSchema.safeParse(file);
  if (!parsed.success) {
    // Paths and codes only: values (amounts, quantities, logo data) never reach the log.
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.code}`).join("; ");
    console.error(`Export: the export does not match the schema (${issues})`);
    throw new Error("export-invalid");
  }
  return parsed.data;
}

/** The one serialization of an export file (pretty-printed, 2 spaces); route and restore use it. */
export function serializeExport(file: ExportFile): string {
  return JSON.stringify(file, null, 2);
}

const BERLIN_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** `depotmanagement-export-<YYYYMMDD-HHMMSS>.json` in Europe/Berlin local time of `now`. */
export function exportFileName(now: Date): string {
  const parts = Object.fromEntries(BERLIN_DATE_TIME.formatToParts(now).map((part) => [part.type, part.value]));
  return `depotmanagement-export-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}.json`;
}
