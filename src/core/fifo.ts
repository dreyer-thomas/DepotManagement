/**
 * FIFO lots and realized Gain/Loss per Security (AD-5, AD-10). Pure, decimal strings only.
 * Gross figures: a lot's cost is `amount + fee`; a sale's proceeds are `amount − fee`; tax is excluded.
 * A holding correction (ADJUSTMENT, story 2.9) adds a lot of `quantity × price` (+) or consumes the
 * oldest units at their Cost Basis (−); it is never a sale and realizes nothing.
 */
import { type CorporateActions, LotBook, replayEvents, splitAdjustment } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";

/**
 * A ledger row as FIFO needs it; only BUY, SELL and ADJUSTMENT with a Security take part. `price` is
 * read only for a positive ADJUSTMENT (its unit cost); loaders that may see ADJUSTMENT rows must select it.
 */
export type FifoRow = {
  securityId: string | null;
  type: string;
  date: string;
  sequence: number;
  quantity: string | null;
  amount: string;
  fee: string;
  price?: string | null;
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
 * Applies one ADJUSTMENT row (with a Security) to `book`: a positive quantity adds a lot (dated at the
 * row) costing `quantity × price`, a negative one consumes |quantity| from the earliest lots. Returns the
 * signed Cost Basis it added (+) or removed (−). Throws when a positive row was loaded without `price`.
 */
export function applyAdjustment(book: LotBook, row: FifoRow): InstanceType<typeof ExactDecimal> {
  const securityId = row.securityId as string;
  const quantity = new ExactDecimal(row.quantity ?? "0");
  if (quantity.isNegative()) return book.sell(securityId, quantity.abs().toFixed()).negated();
  if (quantity.isZero()) return new ExactDecimal(0);
  if (row.price === undefined) throw new TypeError("ADJUSTMENT row loaded without price");
  const cost = quantity.times(row.price ?? "0");
  book.buy(securityId, row.date, row.sequence, quantity.toFixed(), cost);
  return cost;
}

/**
 * Applies one BUY/SELL/ADJUSTMENT row (with a Security) to `book`: a BUY adds a lot costing
 * `amount + fee`, a SELL consumes the earliest lots, an ADJUSTMENT goes through `applyAdjustment`.
 * Returns the Cost Basis a SELL consumed, `null` for a BUY or an ADJUSTMENT (never a sale).
 */
export function applyTrade(book: LotBook, row: FifoRow): InstanceType<typeof ExactDecimal> | null {
  const securityId = row.securityId as string;
  const quantity = row.quantity ?? "0";
  if (row.type === "ADJUSTMENT") {
    applyAdjustment(book, row);
    return null;
  }
  if (row.type === "BUY") {
    book.buy(securityId, row.date, row.sequence, quantity, new ExactDecimal(row.amount).plus(row.fee));
    return null;
  }
  return book.sell(securityId, quantity);
}

/**
 * FIFO per Security over BUY/SELL/ADJUSTMENT rows dated on or before `asOf`, replayed with the corporate actions
 * dated on or before `asOf` (`core/corporate-actions`): on one date splits, then ISIN changes, then
 * Transactions by `(date, sequence)`. A SELL consumes the earliest lots first; a partially consumed lot
 * gives up `cost × taken / quantity`, a fully consumed lot all its remaining cost. Units sold beyond the
 * open lots carry zero cost. An ADJUSTMENT changes lots without a sale (`applyAdjustment`). An ISIN change moves the old Security's open lots (original dates and
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
    const costBasis = applyTrade(book, row);
    if (costBasis === null) continue;
    const proceeds = new ExactDecimal(row.amount).minus(row.fee);
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
