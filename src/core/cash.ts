/**
 * The Cash Account (AD-6/AD-14): the single definition of a Transaction's cash effect and the running
 * balance. Pure, decimal strings only; nothing here is stored.
 */
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { compareLedgerOrder } from "./ledger-order";

/** A ledger row as the Cash Account needs it (AD-14 shape: unsigned `amount`, `fee` ≥ 0, signed `tax`). */
export type CashRow = {
  type: string;
  date: string;
  sequence: number;
  amount: string;
  fee: string;
  tax: string;
};

export type CashBooking<T extends CashRow = CashRow> = T & {
  /** Signed change of the cash balance caused by this row. */
  cashEffect: string;
  /** Running balance after this row. */
  balance: string;
};

type Decimal = InstanceType<typeof ExactDecimal>;

function effect(row: Pick<CashRow, "type" | "amount" | "fee" | "tax">): Decimal {
  const amount = new ExactDecimal(row.amount);
  const fee = new ExactDecimal(row.fee);
  const tax = new ExactDecimal(row.tax);
  switch (row.type) {
    case "BUY":
      return amount.plus(fee).plus(tax).negated();
    case "SELL":
    case "DIVIDEND":
      return amount.minus(fee).minus(tax);
    case "FEE":
      return fee.negated();
    case "TAX":
      return tax.negated();
    case "DEPOSIT":
      return amount;
    case "WITHDRAWAL":
      return amount.negated();
    case "ADJUSTMENT":
      return new ExactDecimal(0);
    default:
      throw new TypeError(`Unknown transaction type: ${row.type}`);
  }
}

/**
 * Signed cash effect: BUY −(amount+fee+tax); SELL/DIVIDEND +amount−fee−tax; FEE −fee; TAX −tax;
 * DEPOSIT +amount; WITHDRAWAL −amount; ADJUSTMENT 0 (holding correction). A negative tax (refund)
 * raises cash.
 */
export function cashEffect(row: Pick<CashRow, "type" | "amount" | "fee" | "tax">): string {
  return canonicalDecimal(effect(row));
}

/** All rows in `(date, sequence)` order, each with its cash effect and the running balance after it. */
export function cashBookings<T extends CashRow>(rows: readonly T[]): CashBooking<T>[] {
  let balance = new ExactDecimal(0);
  return [...rows].sort(compareLedgerOrder).map((row) => {
    const change = effect(row);
    balance = balance.plus(change);
    return { ...row, cashEffect: canonicalDecimal(change), balance: canonicalDecimal(balance) };
  });
}

/** Cash balance as of `asOf` (`YYYY-MM-DD`): the sum of the effects of rows dated on or before it. */
export function cashBalance(rows: readonly CashRow[], asOf: string): string {
  let balance = new ExactDecimal(0);
  for (const row of rows) {
    if (row.date <= asOf) balance = balance.plus(effect(row));
  }
  return canonicalDecimal(balance);
}
