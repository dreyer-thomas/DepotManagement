// Export reader and restore writer of the price marks (AD-12, story 12.2): stop and target per Security are
// user data and travel with the export. Stored strings are kept verbatim; marks reference Securities only by
// id, so the restore writes them after the ledger. The write time is not exported (a restore stamps `now`).
import type { StopMark, TargetMark } from "@/core/price-marks";
import { type MarksDb, rowToMarks } from "./marks";

export type PriceMarkExport = {
  id: string;
  securityId: string;
  stop: StopMark | null;
  target: TargetMark | null;
};

/** Every stored marks row (by id); a row with neither mark is skipped (the service never keeps one). */
export async function exportPriceMarks(db: MarksDb): Promise<PriceMarkExport[]> {
  const rows = await db.priceMark.findMany({
    select: {
      id: true,
      securityId: true,
      stopType: true,
      stopValue: true,
      stopSource: true,
      stopSetDate: true,
      targetPrice: true,
      targetSource: true,
      targetSetDate: true,
      updatedAt: true,
    },
    orderBy: { id: "asc" },
  });
  return rows.flatMap((row) => {
    const { stop, target } = rowToMarks(row);
    return stop === null && target === null ? [] : [{ id: row.id, securityId: row.securityId, stop, target }];
  });
}

/**
 * Deletes every marks row and creates the given (validated, consistent) records with their ids. Must run
 * after the ledger restore: marks reference the restored Securities.
 */
export async function replaceAllPriceMarks(
  records: readonly PriceMarkExport[],
  db: MarksDb,
  now: () => Date = () => new Date(),
): Promise<void> {
  await db.priceMark.deleteMany();
  if (records.length === 0) return;
  const updatedAt = now().toISOString();
  await db.priceMark.createMany({
    data: records.map((record) => ({
      id: record.id,
      securityId: record.securityId,
      stopType: record.stop?.type ?? null,
      stopValue: record.stop?.value ?? null,
      stopSource: record.stop?.source ?? null,
      stopSetDate: record.stop?.setDate ?? null,
      targetPrice: record.target?.price ?? null,
      targetSource: record.target?.source ?? null,
      targetSetDate: record.target?.setDate ?? null,
      updatedAt,
    })),
  });
}
