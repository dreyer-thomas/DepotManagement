/**
 * The daily valuation series of one Depot (AD-10): per calendar day the value of its open Positions
 * (price resolver, carried forward), its Cash Account balance and its invested capital (FIFO Cost Basis
 * of open Positions). Every Period figure, chart and return reads this series. Pure, decimal strings
 * only; nothing here is stored (AD-1).
 */
import { actionEvents, adjustedPrice, type CorporateActions, eventDate, LotBook, type ReplayEvent, replayEvents } from "./corporate-actions";
import { type CashRow, cashEffect } from "./cash";
import { addDays } from "./dates";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { applyTrade, type FifoRow } from "./fifo";
import { compareObservations, type PriceObservation } from "./prices";

type Decimal = InstanceType<typeof ExactDecimal>;

/** A ledger row as the valuation needs it: FIFO fields plus the signed `tax` of the Cash Account. */
export type ValuationRow = FifoRow & CashRow;

/** One day of the series; all amounts are decimal strings. `value = positionsValue + cash`. */
export type ValuationPoint = {
  date: string;
  value: string;
  positionsValue: string;
  cash: string;
  investedCapital: string;
};

type Holding = { securityId: string; quantity: Decimal; costBasis: Decimal };

/**
 * Open Positions of a replayed lot book: per Security with quantity > 0 its quantity (each lot divided
 * by the Security's divisor, as `fifo` reports lots) and Cost Basis.
 */
function openHoldings(book: LotBook): Holding[] {
  const holdings: Holding[] = [];
  for (const securityId of book.securityIds()) {
    const divisor = book.divisor(securityId);
    let quantity = new ExactDecimal(0);
    let costBasis = new ExactDecimal(0);
    for (const lot of book.lots(securityId)) {
      quantity = quantity.plus(lot.quantity.dividedBy(divisor));
      costBasis = costBasis.plus(lot.costBasis);
    }
    if (quantity.greaterThan(0)) holdings.push({ securityId, quantity, costBasis });
  }
  return holdings;
}

function totalCost(holdings: readonly Holding[]): Decimal {
  return holdings.reduce((sum, holding) => sum.plus(holding.costBasis), new ExactDecimal(0));
}

function applyEvent(book: LotBook, event: ReplayEvent<FifoRow>): void {
  if (event.kind === "trade") applyTrade(book, event.row);
  else book.apply(event);
}

/**
 * Invested capital as of `asOf`: the FIFO Cost Basis of the open Positions (quantity > 0) after the
 * Transactions and corporate actions dated on or before `asOf`. The single invested-capital function.
 */
export function investedCapital(rows: readonly FifoRow[], asOf: string, actions: CorporateActions): string {
  const book = new LotBook();
  for (const event of replayEvents(rows, actions, asOf)) applyEvent(book, event);
  return canonicalDecimal(totalCost(openHoldings(book)));
}

/**
 * Observation candidates per held Security for one "segment" of days (between corporate action dates):
 * every observation is carried to the Security it maps to as of those days (ISIN changes dated after
 * it), in resolver order, with a cursor at the last one dated on or before the current day.
 */
class PriceCursor {
  private segment = -1;
  private segmentAsOf = "";
  private lists = new Map<string, { observations: PriceObservation[]; next: number }>();
  private adjusted = new Map<string, string>();
  private readonly sorted: PriceObservation[];
  private readonly actionDates: string[];

  constructor(
    observations: readonly PriceObservation[],
    private readonly actions: CorporateActions,
  ) {
    this.sorted = [...observations].sort(compareObservations);
    this.actionDates = [
      ...new Set([...actions.splits.map((split) => split.date), ...actions.isinChanges.map((change) => change.date)]),
    ].sort();
  }

  private rebuild(day: string): void {
    const events = actionEvents(this.actions, day);
    this.lists = new Map();
    this.adjusted = new Map();
    this.segmentAsOf = day;
    for (const observation of this.sorted) {
      let target = observation.securityId;
      for (const event of events) {
        if (event.kind === "isin-change" && event.change.oldSecurityId === target && observation.date < event.change.date) {
          target = event.change.newSecurityId;
        }
      }
      let list = this.lists.get(target);
      if (!list) this.lists.set(target, (list = { observations: [], next: 0 }));
      list.observations.push(observation);
    }
  }

  /**
   * Price of `securityId` on `day` as `computePositions` resolves it as of `day`; days must be visited
   * in ascending order. `null` without an observation on or before `day`.
   */
  priceOn(securityId: string, day: string): string | null {
    let segment = 0;
    while (segment < this.actionDates.length && this.actionDates[segment] <= day) segment++;
    if (segment !== this.segment) {
      this.segment = segment;
      this.rebuild(day);
    }
    const list = this.lists.get(securityId);
    if (!list) return null;
    while (list.next < list.observations.length && list.observations[list.next].date <= day) list.next++;
    if (list.next === 0) return null;
    const chosen = list.observations[list.next - 1];
    if (this.actionDates.length === 0) return chosen.price;
    let price = this.adjusted.get(chosen.id + "\u0000" + chosen.source);
    if (price === undefined) {
      price = adjustedPrice(chosen.securityId, chosen.date, chosen.price, this.actions, this.segmentAsOf).price;
      this.adjusted.set(chosen.id + "\u0000" + chosen.source, price);
    }
    return price;
  }
}

/**
 * One point per calendar day `from..to` (inclusive): open Positions as of that day (Transactions and
 * corporate actions dated on or before it) valued with the resolver's price of that day (manual >
 * provider > Transaction, carried forward, adjusted to that day's units); an open Position without any
 * price counts 0. Cash is the Cash Account balance, invested capital the open Positions' FIFO Cost
 * Basis. Equivalent per day to `computePositions(rows, observations, day, actions)` + `cashBalance`.
 * Empty when `from > to`.
 */
export function valuationSeries(
  rows: readonly ValuationRow[],
  observations: readonly PriceObservation[],
  actions: CorporateActions,
  from: string,
  to: string,
): ValuationPoint[] {
  if (from > to) return [];
  const events = replayEvents(rows, actions, to);
  const cashRows = rows.filter((row) => row.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const prices = new PriceCursor(
    observations.filter((observation) => observation.date <= to),
    actions,
  );
  const book = new LotBook();
  let nextEvent = 0;
  let nextCash = 0;
  let cash = new ExactDecimal(0);
  let holdings: Holding[] = [];
  let invested = "0";
  let dirty = true;
  const points: ValuationPoint[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    while (nextEvent < events.length && eventDate(events[nextEvent]) <= day) {
      applyEvent(book, events[nextEvent++]);
      dirty = true;
    }
    while (nextCash < cashRows.length && cashRows[nextCash].date <= day) {
      cash = cash.plus(cashEffect(cashRows[nextCash++]));
    }
    if (dirty) {
      holdings = openHoldings(book);
      invested = canonicalDecimal(totalCost(holdings));
      dirty = false;
    }
    let positionsValue = new ExactDecimal(0);
    for (const holding of holdings) {
      const price = prices.priceOn(holding.securityId, day);
      if (price !== null) positionsValue = positionsValue.plus(holding.quantity.times(price));
    }
    points.push({
      date: day,
      value: canonicalDecimal(positionsValue.plus(cash)),
      positionsValue: canonicalDecimal(positionsValue),
      cash: canonicalDecimal(cash),
      investedCapital: invested,
    });
  }
  return points;
}

/**
 * Period flows over rows dated `from..to` (inclusive): dividends = Σ `amount` of DIVIDEND rows (gross),
 * taxes paid = Σ signed `tax` of all rows (paid minus refunds).
 */
export function periodFlows(
  rows: readonly Pick<CashRow, "type" | "date" | "amount" | "tax">[],
  from: string,
  to: string,
): { dividends: string; taxesPaid: string } {
  let dividends = new ExactDecimal(0);
  let taxesPaid = new ExactDecimal(0);
  for (const row of rows) {
    if (row.date < from || row.date > to) continue;
    if (row.type === "DIVIDEND") dividends = dividends.plus(row.amount);
    taxesPaid = taxesPaid.plus(row.tax);
  }
  return { dividends: canonicalDecimal(dividends), taxesPaid: canonicalDecimal(taxesPaid) };
}
