// Restore writer of the ledger tables (story 6.2): the inverse of `exportLedgerData`. Called only by the
// backup module's restore, inside its one interactive transaction, with records already validated
// against the export schema. Rows keep their ids, sequences, decimals and dates exactly as given: no
// duplicate matching, no sequence assignment, no `ensureSecurity`.
import type { LedgerDb } from "./depots";
import type { LedgerExport } from "./export";

/**
 * Deletes every ledger row and inserts `data` verbatim. Deleting the Securities cascades to their
 * ProviderMappings, Prices, logos and news (the prices and logos restores insert theirs afterwards);
 * Depots cascade to import staging, which the restore clears before.
 */
export async function replaceAllLedger(data: LedgerExport, db: LedgerDb): Promise<void> {
  // Restrict FKs first: rows, corporate actions and Transactions reference Securities.
  await db.reconciliationRow.deleteMany();
  await db.reconciliationRun.deleteMany();
  await db.corporateAction.deleteMany();
  await db.transaction.deleteMany();
  await db.depot.deleteMany();
  await db.security.deleteMany();

  if (data.depots.length > 0) await db.depot.createMany({ data: data.depots });
  if (data.securities.length > 0) await db.security.createMany({ data: data.securities });
  if (data.transactions.length > 0) await db.transaction.createMany({ data: data.transactions });
  if (data.corporateActions.length > 0) await db.corporateAction.createMany({ data: data.corporateActions });
  const runs = data.reconciliationRuns.map((run) => ({
    id: run.id,
    depotId: run.depotId,
    statementDate: run.statementDate,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  }));
  if (runs.length > 0) await db.reconciliationRun.createMany({ data: runs });
  const rows = data.reconciliationRuns.flatMap((run) => run.rows);
  if (rows.length > 0) await db.reconciliationRow.createMany({ data: rows });
}
