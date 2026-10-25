/**
 * Funding for Parqet exports (AD-6/AD-14; every export since story 2.8): the minimal same-day deposits
 * that keep the Cash Account from going negative. Pure, decimal strings only.
 */
import { cashEffect, type CashRow } from "./cash";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { compareLedgerOrder } from "./ledger-order";

export type FundingShortfall<T extends CashRow> = {
  /** The row that would push the running balance below zero. */
  row: T;
  /** The deposit (canonical decimal string, > 0) needed directly before `row` to keep the balance at ≥ 0. */
  amount: string;
};

/**
 * Walks `rows` in `(date, sequence)` order from a starting balance of 0. Before any row whose cash effect
 * would push the running balance below zero, a deposit of exactly the shortfall is assumed (so the balance
 * after that row is 0). Rows that keep the balance ≥ 0 need nothing; positive effects (sales, dividends,
 * refunds) therefore fund later rows. Returns the rows needing funding in ledger order.
 */
export function fundingShortfalls<T extends CashRow>(rows: readonly T[]): FundingShortfall<T>[] {
  const result: FundingShortfall<T>[] = [];
  let balance = new ExactDecimal(0);
  for (const row of [...rows].sort(compareLedgerOrder)) {
    const after = balance.plus(cashEffect(row));
    if (after.isNegative()) {
      result.push({ row, amount: canonicalDecimal(after.negated()) });
      balance = new ExactDecimal(0);
    } else {
      balance = after;
    }
  }
  return result;
}
