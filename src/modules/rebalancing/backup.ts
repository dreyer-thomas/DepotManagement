// Export reader and restore writer of the target allocations (AD-12, story 8.5): targets and threshold per
// scope are user data and travel with the export.
import type { Segment } from "@/core/rebalancing";
import { PORTFOLIO_TARGET_SCOPE, type RebalancingDb } from "./targets";

export type TargetAllocationExport = { id: string; scope: string; weights: Partial<Record<Segment, string>>; threshold: string };

/**
 * Target allocations sorted by scope; only rows whose scope is `portfolio` or an existing Depot (a deleted
 * Depot's row is left behind) and whose weights are readable JSON.
 */
export async function exportTargetAllocations(db: RebalancingDb): Promise<TargetAllocationExport[]> {
  const [rows, depots] = await Promise.all([
    db.targetAllocation.findMany({ select: { id: true, scope: true, weights: true, threshold: true }, orderBy: { scope: "asc" } }),
    db.depot.findMany({ select: { id: true } }),
  ]);
  const depotIds = new Set(depots.map((depot) => depot.id));
  return rows.flatMap((row) => {
    if (row.scope !== PORTFOLIO_TARGET_SCOPE && !depotIds.has(row.scope)) return [];
    try {
      return [{ id: row.id, scope: row.scope, weights: JSON.parse(row.weights) as Partial<Record<Segment, string>>, threshold: row.threshold }];
    } catch {
      return [];
    }
  });
}

/** Deletes every target allocation and creates the given (validated) records with their ids. */
export async function replaceAllTargetAllocations(
  records: readonly TargetAllocationExport[],
  db: RebalancingDb,
  now: () => Date = () => new Date(),
): Promise<void> {
  await db.targetAllocation.deleteMany();
  if (records.length === 0) return;
  const updatedAt = now().toISOString();
  await db.targetAllocation.createMany({
    data: records.map((record) => ({ id: record.id, scope: record.scope, weights: JSON.stringify(record.weights), threshold: record.threshold, updatedAt })),
  });
}
