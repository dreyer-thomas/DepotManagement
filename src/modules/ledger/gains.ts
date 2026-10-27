import { prisma } from "@/db";
import type { CorporateActions } from "@/core/corporate-actions";
import type { GainsRow } from "@/core/gains-analysis";
import { loadCorporateActions } from "./corporate-actions";
import type { LedgerDb } from "./depots";
import { listSecurities } from "./securities";
import { loadRows, type ReturnScope } from "./valuation";

/** What the realized-gains and cash-flow analysis (`core/gains-analysis`) reads for a scope. */
export type GainsInput = {
  /** The Depots in scope with all their ledger rows; FIFO runs per Depot. */
  depots: { depotId: string; rows: GainsRow[] }[];
  /** All recorded corporate actions. */
  actions: CorporateActions;
  /** Security id → name, for the sale lists. */
  securityNames: Record<string, string>;
};

/**
 * The ledger rows of `scope` (one Depot, or the Portfolio = non-archived Depots, AD-17), the corporate
 * actions and the Security names, as the gains analysis needs them. Read-only.
 */
export async function gainsInput(scope: ReturnScope, db: LedgerDb = prisma): Promise<GainsInput> {
  const depotIds =
    scope === "portfolio"
      ? (await db.depot.findMany({ where: { archived: false }, select: { id: true }, orderBy: { id: "asc" } })).map((depot) => depot.id)
      : [scope.depotId];
  const [rowsByDepot, actions, securities] = await Promise.all([
    Promise.all(depotIds.map((depotId) => loadRows(depotId, db))),
    loadCorporateActions(db),
    listSecurities(db),
  ]);
  return {
    depots: depotIds.map((depotId, index) => ({ depotId, rows: rowsByDepot[index] })),
    actions,
    securityNames: Object.fromEntries(securities.map((security) => [security.id, security.name])),
  };
}
