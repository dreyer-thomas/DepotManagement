/**
 * Depot reconciliation against a broker statement (story 2.9). Pure, decimal strings only. The app
 * values per row are computed on read for the statement date; the statement values and checks are the
 * user's entries (stored by the ledger, never derived).
 */
import { cashBalance, type CashRow } from "./cash";
import type { CorporateActions } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import type { FifoRow } from "./fifo";
import { computePositions } from "./positions";

/** A ledger row as the reconciliation needs it (Positions and Cash Account). */
export type ReconciliationLedgerRow = FifoRow & CashRow;

/** A saved (user-entered) row of a run; `securityId` null = the Cash Account. */
export type SavedReconciliationRow = { securityId: string | null; statementValue: string | null; checked: boolean };

export type ReconciliationRowStatus = "reconciled" | "difference" | "open";

/** One row of a run as shown: app value on the statement date, the user's entries and the status. */
export type ReconciliationRowView = {
  /** `null` = the Cash Account. */
  securityId: string | null;
  /** Quantity held (Position) or cash balance (Cash Account) on the statement date. */
  appValue: string;
  statementValue: string | null;
  checked: boolean;
  status: ReconciliationRowStatus;
  /** `statement − app` when a statement value is entered; else `null`. */
  difference: string | null;
  /** Average purchase price of the Position on the statement date; `null` for cash or when not held. */
  averagePrice: string | null;
};

export type ReconciliationProgress = { reconciled: number; total: number };

/** Cash matches below half a cent (BUY amounts are stored unrounded; like `core/archive` `isFlat`). */
const HALF_CENT = new ExactDecimal("0.005");

/**
 * Status of one row: `reconciled` when checked or the statement value equals the app value (quantities
 * exact; cash when |difference| < 0.005), `difference` when a value is entered and differs, else `open`.
 */
export function reconciliationStatus(
  isCash: boolean,
  appValue: string,
  statementValue: string | null,
  checked: boolean,
): { status: ReconciliationRowStatus; difference: string | null } {
  const difference = statementValue === null ? null : new ExactDecimal(statementValue).minus(appValue);
  const matches = difference !== null && (isCash ? difference.abs().lessThan(HALF_CENT) : difference.isZero());
  const status: ReconciliationRowStatus = checked || matches ? "reconciled" : difference !== null ? "difference" : "open";
  return { status, difference: difference === null ? null : canonicalDecimal(difference) };
}

/**
 * The rows of a run for `statementDate`: every Position held on that date (quantity > 0,
 * `computePositions` without prices) plus every Security with a saved row (app quantity 0 when no longer
 * held), sorted by Security name (de-DE, `securityNames`; unknown names sort as empty), then the Cash
 * Account (`cashBalance` on the statement date). Saved entries are merged in; progress counts reconciled
 * rows of all rows.
 */
export function reconciliationRows(
  rows: readonly ReconciliationLedgerRow[],
  actions: CorporateActions,
  statementDate: string,
  saved: readonly SavedReconciliationRow[],
  securityNames: ReadonlyMap<string, string>,
): { rows: ReconciliationRowView[]; progress: ReconciliationProgress } {
  const held = new Map<string, { quantity: string; averagePrice: string }>();
  for (const position of computePositions(rows, [], statementDate, actions)) held.set(position.securityId, position);
  const savedBySecurity = new Map<string | null, SavedReconciliationRow>();
  for (const row of saved) savedBySecurity.set(row.securityId, row);

  const securityIds = new Set<string>(held.keys());
  for (const row of saved) if (row.securityId !== null) securityIds.add(row.securityId);
  const ordered = [...securityIds].sort(
    (a, b) => (securityNames.get(a) ?? "").localeCompare(securityNames.get(b) ?? "", "de-DE") || (a < b ? -1 : a > b ? 1 : 0),
  );

  const view = (securityId: string | null, appValue: string, averagePrice: string | null): ReconciliationRowView => {
    const entry = savedBySecurity.get(securityId);
    const statementValue = entry?.statementValue ?? null;
    const checked = entry?.checked ?? false;
    const status = reconciliationStatus(securityId === null, appValue, statementValue, checked);
    return { securityId, appValue, statementValue, checked, ...status, averagePrice };
  };

  const result = [
    ...ordered.map((securityId) => {
      const position = held.get(securityId);
      return view(securityId, position?.quantity ?? "0", position?.averagePrice ?? null);
    }),
    view(null, cashBalance(rows, statementDate), null),
  ];
  return {
    rows: result,
    progress: { reconciled: result.filter((row) => row.status === "reconciled").length, total: result.length },
  };
}
