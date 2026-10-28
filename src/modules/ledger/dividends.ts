import type { CorporateActions } from "@/core/corporate-actions";
import type { DividendDepotInput } from "@/core/dividend-analysis";
import type { LedgerDb } from "./depots";
import { gainsInput } from "./gains";
import { type ListPositionsOptions, listPositions } from "./positions";
import type { ReturnScope } from "./valuation";

/** What the dividend analysis (`core/dividend-analysis`) reads for a scope. */
export type DividendAnalysisInput = {
  /** The Depots in scope with all their ledger rows and today's Positions. */
  depots: DividendDepotInput[];
  actions: CorporateActions;
  /** Security id → name, for the per-Security lists. */
  securityNames: Record<string, string>;
};

/**
 * `gainsInput(scope)` plus each Depot's Positions as of `today` (`listPositions` with `storedPrices`, as the
 * Aufteilung tab), as the dividend analysis needs them. `db` is handed through (the services default to
 * the app database). Read-only.
 */
export async function dividendAnalysisInput(
  scope: ReturnScope,
  today: string,
  db?: LedgerDb,
  { storedPrices }: ListPositionsOptions = {},
): Promise<DividendAnalysisInput> {
  const { depots, actions, securityNames } = await (db === undefined ? gainsInput(scope) : gainsInput(scope, db));
  const positionsByDepot = await Promise.all(depots.map((depot) => listPositions(depot.depotId, today, db, { storedPrices })));
  return {
    depots: depots.map((depot, index) => ({
      ...depot,
      positions: positionsByDepot[index].map((position) => ({
        securityId: position.security.id,
        quantity: position.quantity,
        value: position.value,
        costBasis: position.costBasis,
      })),
    })),
    actions,
    securityNames,
  };
}
