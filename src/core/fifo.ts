/**
 * FIFO lots and realized Gain/Loss per Security (AD-5, AD-10). Pure, decimal strings only.
 * Gross figures: a lot's cost is `amount + fee`; a sale's proceeds are `amount − fee`; tax is excluded.
 */
import { scaleTrades, type Split, splitDivisor } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { compareLedgerOrder } from "./ledger-order";

/** A ledger row as FIFO needs it; only BUY and SELL with a Security take part. */
export type FifoRow = {
  securityId: string | null;
  type: string;
  date: string;
  sequence: number;
  quantity: string | null;
  amount: string;
  fee: string;
};

/** An open lot: remaining quantity and the Cost Basis of those units. */
export type FifoLot = { date: string; sequence: number; quantity: string; costBasis: string };

/** One SELL: its quantity, proceeds (`amount − fee`), the Cost Basis it consumed and the realized gain. */
export type FifoSale = {
  date: string;
  sequence: number;
  quantity: string;
  proceeds: string;
  costBasis: string;
  gain: string;
};

export type FifoResult = { securityId: string; lots: FifoLot[]; sales: FifoSale[] };

type Decimal = InstanceType<typeof ExactDecimal>;
type OpenLot = { date: string; sequence: number; quantity: Decimal; costBasis: Decimal };

/**
 * FIFO per Security over BUY/SELL rows dated on or before `asOf`, ordered by `(date, sequence)`.
 * A SELL consumes the earliest lots first; a partially consumed lot gives up `cost × taken / quantity`,
 * a fully consumed lot all its remaining cost. Units sold beyond the open lots carry zero cost.
 * Results keep the order in which each Security first appears in the ledger. Quantities are
 * split-adjusted as of `asOf` (`core/corporate-actions`): lots are consumed in the exact scaled basis
 * and divided once on output; costs and proceeds are unaffected.
 */
export function fifo(rows: readonly FifoRow[], asOf: string, splits: readonly Split[]): FifoResult[] {
  const trades = scaleTrades(
    rows.filter((row) => row.securityId !== null && (row.type === "BUY" || row.type === "SELL") && row.date <= asOf),
    splits,
    asOf,
  ).sort(compareLedgerOrder);

  const bySecurity = new Map<string, { lots: OpenLot[]; sales: FifoSale[]; divisor: Decimal }>();
  for (const row of trades) {
    const securityId = row.securityId as string;
    let state = bySecurity.get(securityId);
    if (!state) {
      state = { lots: [], sales: [], divisor: splitDivisor(securityId, splits, asOf) };
      bySecurity.set(securityId, state);
    }
    const quantity = new ExactDecimal(row.quantity ?? "0");
    const amount = new ExactDecimal(row.amount);
    const fee = new ExactDecimal(row.fee);

    if (row.type === "BUY") {
      if (quantity.greaterThan(0)) {
        state.lots.push({ date: row.date, sequence: row.sequence, quantity, costBasis: amount.plus(fee) });
      }
      continue;
    }

    let remaining = quantity;
    let costBasis = new ExactDecimal(0);
    while (remaining.greaterThan(0) && state.lots.length > 0) {
      const lot = state.lots[0];
      if (remaining.greaterThanOrEqualTo(lot.quantity)) {
        costBasis = costBasis.plus(lot.costBasis);
        remaining = remaining.minus(lot.quantity);
        state.lots.shift();
      } else {
        const taken = lot.costBasis.times(remaining).dividedBy(lot.quantity);
        costBasis = costBasis.plus(taken);
        lot.costBasis = lot.costBasis.minus(taken);
        lot.quantity = lot.quantity.minus(remaining);
        remaining = new ExactDecimal(0);
      }
    }
    const proceeds = amount.minus(fee);
    state.sales.push({
      date: row.date,
      sequence: row.sequence,
      quantity: canonicalDecimal(quantity.dividedBy(state.divisor)),
      proceeds: canonicalDecimal(proceeds),
      costBasis: canonicalDecimal(costBasis),
      gain: canonicalDecimal(proceeds.minus(costBasis)),
    });
  }

  return [...bySecurity].map(([securityId, state]) => ({
    securityId,
    lots: state.lots.map((lot) => ({
      date: lot.date,
      sequence: lot.sequence,
      quantity: canonicalDecimal(lot.quantity.dividedBy(state.divisor)),
      costBasis: canonicalDecimal(lot.costBasis),
    })),
    sales: state.sales,
  }));
}
