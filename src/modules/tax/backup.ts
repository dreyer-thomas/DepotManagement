// Export reader and restore writer of the tax settings (AD-12, story 8.3): Freistellungsaufträge and
// Teilfreistellung overrides are user data and travel with the export.
import type { Broker } from "@/modules/ledger";
import type { TaxDb } from "./settings";

export type TaxAllowanceExport = { id: string; broker: Broker; year: number; amount: string };
export type TeilfreistellungOverrideExport = { id: string; securityId: string; rate: string };
export type TaxSettingsExport = { taxAllowances: TaxAllowanceExport[]; teilfreistellungOverrides: TeilfreistellungOverrideExport[] };

/** Allowances sorted by year, broker; overrides sorted by `securityId`. */
export async function exportTaxSettings(db: TaxDb): Promise<TaxSettingsExport> {
  const [taxAllowances, teilfreistellungOverrides] = await Promise.all([
    db.taxAllowance.findMany({ select: { id: true, broker: true, year: true, amount: true }, orderBy: [{ year: "asc" }, { broker: "asc" }] }),
    db.teilfreistellungOverride.findMany({ select: { id: true, securityId: true, rate: true }, orderBy: { securityId: "asc" } }),
  ]);
  return { taxAllowances, teilfreistellungOverrides };
}

/**
 * Deletes every allowance and override and creates the given records with their ids. Expects validated
 * records whose Securities exist (the backup module checks both before calling).
 */
export async function replaceAllTaxSettings(
  settings: TaxSettingsExport,
  db: TaxDb,
  now: () => Date = () => new Date(),
): Promise<void> {
  await db.taxAllowance.deleteMany();
  await db.teilfreistellungOverride.deleteMany();
  const updatedAt = now().toISOString();
  if (settings.taxAllowances.length > 0) {
    await db.taxAllowance.createMany({ data: settings.taxAllowances.map((record) => ({ ...record, updatedAt })) });
  }
  if (settings.teilfreistellungOverrides.length > 0) {
    await db.teilfreistellungOverride.createMany({ data: settings.teilfreistellungOverrides.map((record) => ({ ...record, updatedAt })) });
  }
}
