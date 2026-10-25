/**
 * FIFO lots and realized Gain/Loss per Security (AD-5, AD-10). Pure, decimal strings only.
 * Gross figures: a lot's cost is `amount + fee`; a sale's proceeds are `amount − fee`; tax is excluded.
 */
import { type CorporateActions, LotBook, replayEvents, splitAdjustment } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";

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

/**
 * FIFO per Security over BUY/SELL rows dated on or before `asOf`, replayed with the corporate actions
 * dated on or before `asOf` (`core/corporate-actions`): on one date splits, then ISIN changes, then
 * Transactions by `(date, sequence)`. A SELL consumes the earliest lots first; a partially consumed lot
 * gives up `cost × taken / quantity`, a fully consumed lot all its remaining cost. Units sold beyond the
 * open lots carry zero cost. An ISIN change moves the old Security's open lots (original dates and
 * Cost Basis) into the new Security. Results keep the order in which each Security first appears.
 * Lot quantities are in the units as of `asOf`; a sale's quantity is the SELL's quantity split-adjusted
 * as of `asOf` for its own Security. Costs and proceeds are unaffected by corporate actions.
 */
export function fifo(rows: readonly FifoRow[], asOf: string, actions: CorporateActions): FifoResult[] {
  const book = new LotBook();
  const sales = new Map<string, FifoSale[]>();
  for (const event of replayEvents(rows, actions, asOf)) {
    if (event.kind !== "trade") {
      book.apply(event);
      continue;
    }
    const row = event.row;
    const securityId = row.securityId as string;
    const quantity = row.quantity ?? "0";
    const amount = new ExactDecimal(row.amount);
    const fee = new ExactDecimal(row.fee);
    if (row.type === "BUY") {
      book.buy(securityId, row.date, row.sequence, quantity, amount.plus(fee));
      continue;
    }
    const costBasis = book.sell(securityId, quantity);
    const proceeds = amount.minus(fee);
    let list = sales.get(securityId);
    if (!list) sales.set(securityId, (list = []));
    list.push({
      date: row.date,
      sequence: row.sequence,
      quantity: splitAdjustment(securityId, row.date, quantity, actions.splits, asOf) ?? canonicalDecimal(quantity),
      proceeds: canonicalDecimal(proceeds),
      costBasis: canonicalDecimal(costBasis),
      gain: canonicalDecimal(proceeds.minus(costBasis)),
    });
  }

  return book.securityIds().map((securityId) => {
    const divisor = book.divisor(securityId);
    return {
      securityId,
      lots: book.lots(securityId).map((lot) => ({
        date: lot.date,
        sequence: lot.sequence,
        quantity: canonicalDecimal(lot.quantity.dividedBy(divisor)),
        costBasis: canonicalDecimal(lot.costBasis),
      })),
      sales: sales.get(securityId) ?? [],
    };
  });
}
