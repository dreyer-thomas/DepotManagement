// Export reader and restore writer of manual classification overrides (AD-12, story 7.1). Overrides are
// user data; the automatic layer is a cache and is never exported: a restored row has only its manual
// values and is completed by the next refresh (`providerSymbol` null → provider pending).
import { type Dimension, DIMENSIONS } from "@/core/classification";
import { type ClassificationDb, MANUAL_COLUMN } from "./classification";

/** One exported row: ids and the manual value per dimension (`null` = automatic). */
export type ClassificationExport = { id: string; securityId: string } & Record<Dimension, string | null>;

/** Rows with at least one manual value, sorted by `securityId`. */
export async function exportClassifications(db: ClassificationDb): Promise<ClassificationExport[]> {
  const rows = await db.securityClassification.findMany({ orderBy: { securityId: "asc" } });
  return rows
    .map((row) => {
      const record = { id: row.id, securityId: row.securityId } as ClassificationExport;
      for (const dimension of DIMENSIONS) record[dimension] = row[MANUAL_COLUMN[dimension]];
      return record;
    })
    .filter((record) => DIMENSIONS.some((dimension) => record[dimension] !== null));
}

/**
 * Deletes every SecurityClassification row and creates one row per record with its id and manual
 * values only (the automatic layer is refilled by the next refresh). Expects validated records whose
 * Securities exist (the backup module checks both before calling).
 */
export async function replaceAllClassifications(
  records: readonly ClassificationExport[],
  db: ClassificationDb,
  now: () => Date = () => new Date(),
): Promise<void> {
  await db.securityClassification.deleteMany();
  if (records.length === 0) return;
  const updatedAt = now().toISOString();
  await db.securityClassification.createMany({
    data: records.map((record) => {
      const data: Record<string, string | null> = { id: record.id, securityId: record.securityId, updatedAt };
      for (const dimension of DIMENSIONS) data[MANUAL_COLUMN[dimension]] = record[dimension];
      return data as { id: string; securityId: string; updatedAt: string };
    }),
  });
}
