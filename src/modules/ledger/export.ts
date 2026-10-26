// Export reader of the ledger tables (story 6.1): every stored column as stored, no relations, nothing
// derived. Used by the backup module inside its snapshot transaction.
import type { LedgerDb } from "./depots";

/** All ledger rows, sorted by stable unique keys so the same data always yields the same export. */
export async function exportLedgerData(db: LedgerDb) {
  const depots = await db.depot.findMany({
    select: { id: true, name: true, broker: true, archived: true },
    orderBy: { id: "asc" },
  });
  const securities = await db.security.findMany({
    select: { id: true, isin: true, cryptoSymbol: true, name: true, assetType: true },
    orderBy: { id: "asc" },
  });
  const transactions = await db.transaction.findMany({
    select: {
      id: true,
      depotId: true,
      securityId: true,
      type: true,
      date: true,
      sequence: true,
      quantity: true,
      price: true,
      amount: true,
      fee: true,
      tax: true,
      note: true,
    },
    orderBy: [{ depotId: "asc" }, { date: "asc" }, { sequence: "asc" }],
  });
  const corporateActions = await db.corporateAction.findMany({
    select: { id: true, securityId: true, newSecurityId: true, type: true, date: true, ratioOld: true, ratioNew: true },
    orderBy: [{ securityId: "asc" }, { type: "asc" }, { date: "asc" }],
  });
  const reconciliationRuns = await db.reconciliationRun.findMany({
    select: {
      id: true,
      depotId: true,
      statementDate: true,
      status: true,
      createdAt: true,
      finishedAt: true,
      rows: {
        select: { id: true, runId: true, securityId: true, statementValue: true, checked: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
  return { depots, securities, transactions, corporateActions, reconciliationRuns };
}

export type LedgerExport = Awaited<ReturnType<typeof exportLedgerData>>;
