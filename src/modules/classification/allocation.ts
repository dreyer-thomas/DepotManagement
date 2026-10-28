// Allocation of the Portfolio or one Depot by a classification dimension (Analysen › Aufteilung, story 7.2;
// region split 8.4): one function for the page and the MCP tool.
import { type Allocation, allocation } from "@/core/allocation";
import { compositionHoldings, getDepot, listDepots, type ListPositionsOptions, listPositions } from "@/modules/ledger";
import { type AllocationDimension, ALLOCATION_LABELS, allocationHoldings } from "./allocation-groups";
import { type ClassificationDb, listClassifications, listRegionSplits } from "./classification";

export * from "./allocation-groups";

/** The scope of an allocation: the Portfolio (non-archived Depots, AD-17) or one Depot. */
export type AllocationScope = "portfolio" | { depotId: string };

/**
 * A today snapshot of `scope` grouped by `dimension`: the Positions as of `today` (`listPositions` with
 * `storedPrices`; priced ones only, as the composition card) plus each Depot's Cash Account, grouped by the
 * effective classification (unclassified = "Unbekannt"); by "Region" a fund with a region split is
 * distributed over its regions. An unknown Depot gives an empty allocation. `db` is handed through (the
 * services default to the app database). Read-only.
 */
export async function allocationAnalysis(
  scope: AllocationScope,
  dimension: AllocationDimension,
  today: string,
  db?: ClassificationDb,
  { storedPrices }: ListPositionsOptions = {},
): Promise<Allocation> {
  const inScope =
    scope === "portfolio"
      ? (await listDepots(db)).filter((depot) => !depot.archived)
      : await getDepot(scope.depotId, db).then((depot) => (depot ? [depot] : []));
  const [positionsByDepot, classifications, regionSplits] = await Promise.all([
    Promise.all(inScope.map((depot) => listPositions(depot.id, today, db, { storedPrices }))),
    listClassifications(db),
    dimension === "region" ? listRegionSplits(db) : Promise.resolve({}),
  ]);
  const holdings = inScope.flatMap((depot, index) => compositionHoldings(depot, positionsByDepot[index]));
  return allocation(
    allocationHoldings(holdings, classifications, dimension, regionSplits),
    inScope.map((depot) => depot.cashBalance),
    ALLOCATION_LABELS,
  );
}
