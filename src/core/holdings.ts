/**
 * Held quantities from BUY/SELL rows, ordered by (date, sequence). Pure, decimal strings only.
 */
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { compareLedgerOrder } from "./ledger-order";

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
  const rows = trades
    .filter((row) => row.securityId === securityId && (row.type === "BUY" || row.type === "SELL"))
    .sort(compareLedgerOrder);
  let held = new ExactDecimal(0);
  let index = 0;
  for (; index < rows.length && rows[index].date <= date; index++) {
    held = apply(held, rows[index]);
  }
  let minimum = held;
  for (; index < rows.length; index++) {
    held = apply(held, rows[index]);
    if (held.lessThan(minimum)) minimum = held;
  }
  return canonicalDecimal(ExactDecimal.max(minimum, 0));
}

function apply(held: InstanceType<typeof ExactDecimal>, row: TradeRow) {
  const quantity = new ExactDecimal(row.quantity ?? "0");
  return row.type === "BUY" ? held.plus(quantity) : held.minus(quantity);
}
