/**
 * Held quantities from BUY/SELL rows, ordered by (date, sequence). Pure, decimal strings only.
 * Quantities are compared in the exact scaled "all splits" basis (`ALL_SPLITS`, see
 * `core/corporate-actions`), so pre- and post-split units never mix; results are converted back to
 * the units of the queried position.
 */
import { ALL_SPLITS, scaleTrades, type Split, splitScale } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { compareLedgerOrder, type LedgerOrdered } from "./ledger-order";

export type TradeRow = {
  securityId: string | null;
  type: string;
  date: string;
  sequence: number;
  quantity: string | null;
};

/**
 * Quantity of `securityId` a SELL appended at the end of `date` may take: the minimum running held
 * quantity from that insertion point through the end of the ledger, so no later SELL goes negative.
 * BUY adds, SELL subtracts; other types are ignored. Never below zero. In the units of `date`.
 */
export function sellableQuantity(
  trades: readonly TradeRow[],
  securityId: string,
  date: string,
  splits: readonly Split[],
): string {
  return sellableAt(trades, securityId, { date, sequence: Number.POSITIVE_INFINITY }, splits);
}

/** The Security's BUY/SELL rows in ledger order, quantities in the scaled "all splits" basis. */
function tradesOf<T extends TradeRow>(trades: readonly T[], securityId: string, splits: readonly Split[]): T[] {
  return scaleTrades(
    trades.filter((row) => row.securityId === securityId && (row.type === "BUY" || row.type === "SELL")),
    splits,
    ALL_SPLITS,
  ).sort(compareLedgerOrder);
}

/**
 * Quantity of `securityId` a SELL placed at `position` may take: the minimum running held quantity
 * from just before `position` through the end of the ledger (rows at or after `position` count as
 * later). Pass the ledger without the SELL itself. Never below zero. The result is in the units of a
 * row dated `position.date` (split-adjusted back from the "all splits" basis).
 */
export function sellableAt(
  trades: readonly TradeRow[],
  securityId: string,
  position: LedgerOrdered,
  splits: readonly Split[],
): string {
  const rows = tradesOf(trades, securityId, splits);
  let held = new ExactDecimal(0);
  let index = 0;
  for (; index < rows.length && compareLedgerOrder(rows[index], position) < 0; index++) {
    held = apply(held, rows[index]);
  }
  let minimum = held;
  for (; index < rows.length; index++) {
    held = apply(held, rows[index]);
    if (held.lessThan(minimum)) minimum = held;
  }
  const available = ExactDecimal.max(minimum, 0).dividedBy(splitScale(securityId, position.date, splits, ALL_SPLITS));
  return canonicalDecimal(available);
}

/**
 * The first SELL of `securityId`, in ledger order, after which the running (split-scaled) held
 * quantity is negative; else `null`. Returns the row as passed in (unadjusted).
 */
export function firstOversell<T extends TradeRow>(
  trades: readonly T[],
  securityId: string,
  splits: readonly Split[],
): T | null {
  const original = new Map<TradeRow, T>();
  const relevant = trades.filter((row) => row.securityId === securityId);
  const adjusted = scaleTrades(relevant, splits, ALL_SPLITS);
  adjusted.forEach((row, index) => original.set(row, relevant[index]));
  let held = new ExactDecimal(0);
  for (const row of tradesOf(adjusted, securityId, [])) {
    held = apply(held, row);
    if (row.type === "SELL" && held.isNegative()) return original.get(row) ?? row;
  }
  return null;
}

function apply(held: InstanceType<typeof ExactDecimal>, row: TradeRow) {
  const quantity = new ExactDecimal(row.quantity ?? "0");
  return row.type === "BUY" ? held.plus(quantity) : held.minus(quantity);
}
