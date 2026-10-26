// Restore writer of the prices tables (story 6.2): the inverse of `exportPriceData`. Called only by the
// backup module's restore inside its transaction, after the ledger restore inserted the Securities.
import type { PriceExport } from "./export";
import type { PricesDb } from "./mappings";

/** Deletes every ProviderMapping and Price and inserts the given rows verbatim (ids and decimals kept). */
export async function replaceAllPrices(data: PriceExport, db: PricesDb): Promise<void> {
  await db.providerMapping.deleteMany();
  await db.price.deleteMany();
  if (data.providerMappings.length > 0) await db.providerMapping.createMany({ data: data.providerMappings });
  if (data.prices.length > 0) await db.price.createMany({ data: data.prices });
}
