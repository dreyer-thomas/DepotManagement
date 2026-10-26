// Export reader of the prices tables (story 6.1): every stored column as stored, sorted by unique keys.
import type { PricesDb } from "./mappings";

/** All ProviderMappings (including "not found" markers) and all stored Prices (MANUAL and PROVIDER). */
export async function exportPriceData(db: PricesDb) {
  const providerMappings = await db.providerMapping.findMany({
    select: {
      id: true,
      securityId: true,
      provider: true,
      symbol: true,
      origin: true,
      updatedAt: true,
      historyFrom: true,
      fetchedAt: true,
      fetchError: true,
    },
    orderBy: { securityId: "asc" },
  });
  const prices = await db.price.findMany({
    select: { id: true, securityId: true, date: true, source: true, price: true, fetchedAt: true },
    orderBy: [{ securityId: "asc" }, { date: "asc" }, { source: "asc" }],
  });
  return { providerMappings, prices };
}

export type PriceExport = Awaited<ReturnType<typeof exportPriceData>>;
