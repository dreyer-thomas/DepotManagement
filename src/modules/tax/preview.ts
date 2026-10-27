import { prisma } from "@/db";
import type { GainsRow } from "@/core/gains-analysis";
import { type TaxPreviewInput, type TaxSecurity, taxSecurity } from "@/core/tax";
import { listClassifications } from "@/modules/classification";
import { BROKERS, type Broker, taxLedgerInput } from "@/modules/ledger";
import { listTaxAllowances, listTeilfreistellungOverrides, type TaxDb } from "./settings";

/**
 * Everything `core/tax` `taxPreview` needs except "today"; each Depot keeps its id so the rebalancing
 * proposal (story 8.5) can append hypothetical sales per Depot.
 */
export type TaxPreviewData = Omit<TaxPreviewInput, "today" | "brokers" | "depots"> & {
  depots: { depotId: string; broker: Broker; rows: GainsRow[] }[];
  brokers: Broker[];
};

/**
 * Gathers the tax preview input: every Depot's rows (archived included) with its broker, the corporate
 * actions, the tax category of every Security (effective classification + Teilfreistellung override),
 * the stored allowances and the brokers that have at least one Depot (enum order). Read-only.
 */
export async function taxPreviewInput(db: TaxDb = prisma): Promise<TaxPreviewData> {
  const [ledger, classifications, overrides, allowances] = await Promise.all([
    taxLedgerInput(db),
    listClassifications(db),
    listTeilfreistellungOverrides(db),
    listTaxAllowances(db),
  ]);
  const securities: Record<string, TaxSecurity> = {};
  for (const [securityId, classification] of Object.entries(classifications)) {
    securities[securityId] = taxSecurity({ type: classification.type, assetClass: classification.assetClass.value }, overrides[securityId] ?? null);
  }
  const used = new Set(ledger.depots.map((depot) => depot.broker));
  return {
    depots: ledger.depots.map((depot) => ({ depotId: depot.depotId, broker: depot.broker, rows: depot.rows })),
    actions: ledger.actions,
    securities,
    allowances,
    brokers: BROKERS.filter((broker) => used.has(broker)),
  };
}
