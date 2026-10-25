/**
 * Held quantities from BUY/SELL rows, ordered by (date, sequence). Pure, decimal strings only.
 */
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
 * BUY adds, SELL subtracts; other types are ignored. Never below zero.
 */
export function sellableQuantity(trades: readonly TradeRow[], securityId: string, date: string): string {
  return sellableAt(trades, securityId, { date, sequence: Number.POSITIVE_INFINITY });
}

/** The Security's BUY/SELL rows in ledger order. */
function tradesOf<T extends TradeRow>(trades: readonly T[], securityId: string): T[] {
  return trades
    .filter((row) => row.securityId === securityId && (row.type === "BUY" || row.type === "SELL"))
    .sort(compareLedgerOrder);
}

/**
 * Quantity of `securityId` a SELL placed at `position` may take: the minimum running held quantity
 * from just before `position` through the end of the ledger (rows at or after `position` count as
 * later). Pass the ledger without the SELL itself. Never below zero.
 */
export function sellableAt(trades: readonly TradeRow[], securityId: string, position: LedgerOrdered): string {
  const rows = tradesOf(trades, securityId);
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
  return canonicalDecimal(ExactDecimal.max(minimum, 0));
}

/** The first SELL of `securityId`, in ledger order, after which the running held quantity is negative; else `null`. */
export function firstOversell<T extends TradeRow>(trades: readonly T[], securityId: string): T | null {
  let held = new ExactDecimal(0);
  for (const row of tradesOf(trades, securityId)) {
    held = apply(held, row);
    if (row.type === "SELL" && held.isNegative()) return row;
  }
  return null;
}

function apply(held: InstanceType<typeof ExactDecimal>, row: TradeRow) {
  const quantity = new ExactDecimal(row.quantity ?? "0");
  return row.type === "BUY" ? held.plus(quantity) : held.minus(quantity);
}
