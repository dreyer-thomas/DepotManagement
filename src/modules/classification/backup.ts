// Export reader and restore writer of manual classification overrides (AD-12, story 7.1) and manual region
// splits (story 8.4). Overrides are user data; the automatic layer and the rule split are a cache and are
// never exported: a restored row has only its manual values and is completed by the next refresh
// (`providerSymbol` null → provider pending).
import { type Dimension, DIMENSIONS } from "@/core/classification";
import { deserializeRegionSplit, regionSplitFromRecord, regionSplitRecord, serializeRegionSplit, type SplitRegion } from "@/core/region-split";
import { type ClassificationDb, MANUAL_COLUMN } from "./classification";

/**
 * One exported row: ids, the manual value per dimension (`null` = automatic) and the manual region split
 * (percent per split region, `null` = automatic).
 */
export type ClassificationExport = { id: string; securityId: string } & Record<Dimension, string | null> & {
    regionSplit: Partial<Record<SplitRegion, string>> | null;
  };

/** Rows with at least one manual value or a manual region split, sorted by `securityId`. */
export async function exportClassifications(db: ClassificationDb): Promise<ClassificationExport[]> {
  const rows = await db.securityClassification.findMany({ orderBy: { securityId: "asc" } });
  return rows
    .map((row) => {
      const record = { id: row.id, securityId: row.securityId } as ClassificationExport;
      for (const dimension of DIMENSIONS) record[dimension] = row[MANUAL_COLUMN[dimension]];
      const split = deserializeRegionSplit(row.regionSplitManual);
      record.regionSplit = split ? regionSplitRecord(split) : null;
      return record;
    })
    .filter((record) => record.regionSplit !== null || DIMENSIONS.some((dimension) => record[dimension] !== null));
}

/**
 * Deletes every SecurityClassification row and creates one row per record with its id, manual values and
 * manual region split only (the automatic layer and rule split are refilled by the next refresh). Expects
 * validated records whose Securities exist (the backup module checks both before calling).
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
      const split = record.regionSplit ? regionSplitFromRecord(record.regionSplit) : null;
      data.regionSplitManual = split ? serializeRegionSplit(split) : null;
      return data as { id: string; securityId: string; updatedAt: string };
    }),
  });
}
