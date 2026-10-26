/**
 * Held quantities from BUY/SELL/ADJUSTMENT rows of one Depot, replayed with every corporate action
 * (`core/corporate-actions`, `ALL_ACTIONS`): splits scale holdings, ISIN changes move them to the new
 * Security. Pure, decimal strings only. Quantities are compared exactly (scaled basis, divided once on
 * output); results are in the units of the queried position.
 */
import {
  ALL_ACTIONS,
  type CorporateActions,
  LotBook,
  type ReplayEvent,
  removesUnits,
  replayEvents,
} from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { compareLedgerOrder, type LedgerOrdered } from "./ledger-order";

type Decimal = InstanceType<typeof ExactDecimal>;

export type TradeRow = {
  securityId: string | null;
  type: string;
  date: string;
  sequence: number;
  quantity: string | null;
};

function applyEvent(book: LotBook, event: ReplayEvent<TradeRow>): void {
  if (event.kind !== "trade") book.apply(event);
  else book.applyQuantity(event.row);
}

/** True when `event` lies before `position` (actions dated on or before its date come first). */
function isBefore(event: ReplayEvent<TradeRow>, position: LedgerOrdered): boolean {
  if (event.kind === "trade") return compareLedgerOrder(event.row, position) < 0;
  const date = event.kind === "split" ? event.split.date : event.change.date;
  return date <= position.date;
}

/**
 * Quantity of `securityId` a SELL appended at the end of `date` may take: the minimum running held
 * quantity from that insertion point through the end of the ledger, so no later SELL goes negative.
 * Never below zero. In the units of `date`.
 */
export function sellableQuantity(
  trades: readonly TradeRow[],
  securityId: string,
  date: string,
  actions: CorporateActions,
): string {
  return sellableAt(trades, securityId, { date, sequence: Number.POSITIVE_INFINITY }, actions);
}

/**
 * Quantity of `securityId` a SELL placed at `position` may take: the minimum held quantity of its
 * lineage from just before `position` through the end of the ledger (rows at or after `position`
 * count as later). The lineage follows the Security through later splits (units × new/old) and ISIN
 * changes (to the new Security, units × n/o); each held quantity is converted back to the SELL's units.
 * Pass the ledger without the SELL itself. Never below zero. In the units of a row dated `position.date`.
 */
export function sellableAt(
  trades: readonly TradeRow[],
  securityId: string,
  position: LedgerOrdered,
  actions: CorporateActions,
): string {
  const events = replayEvents(trades, actions, ALL_ACTIONS);
  const book = new LotBook();
  let index = 0;
  for (; index < events.length && isBefore(events[index], position); index++) applyEvent(book, events[index]);

  let lineage = securityId;
  // Units of the lineage per unit of the SELL: gNum / gDen.
  let gNum: Decimal = new ExactDecimal(1);
  let gDen: Decimal = new ExactDecimal(1);
  // held / g = scaled × gDen / (divisor × gNum)
  const ratio = () => {
    const { scaled, divisor } = book.net(lineage);
    return { num: scaled.times(gDen), den: divisor.times(gNum) };
  };
  let minimum = ratio();
  for (; index < events.length; index++) {
    const event = events[index];
    applyEvent(book, event);
    if (event.kind === "split" && event.split.securityId === lineage) {
      gNum = gNum.times(event.split.ratioNew);
      gDen = gDen.times(event.split.ratioOld);
    } else if (event.kind === "isin-change" && event.change.oldSecurityId === lineage) {
      lineage = event.change.newSecurityId;
      gNum = gNum.times(event.change.newQuantity);
      gDen = gDen.times(event.change.oldQuantity);
    }
    const current = ratio();
    if (current.num.times(minimum.den).lessThan(minimum.num.times(current.den))) minimum = current;
  }
  if (!minimum.num.greaterThan(0)) return "0";
  return canonicalDecimal(minimum.num.dividedBy(minimum.den));
}

/**
 * The first SELL or negative ADJUSTMENT (any Security), in replay order with every corporate action,
 * after which its Security's net held quantity is negative; else `null`. Returns the row as passed in.
 */
export function firstOversell<T extends TradeRow>(trades: readonly T[], actions: CorporateActions): T | null {
  const book = new LotBook();
  for (const event of replayEvents(trades, actions, ALL_ACTIONS)) {
    applyEvent(book, event);
    if (event.kind === "trade" && removesUnits(event.row) && book.net(event.row.securityId as string).scaled.isNegative()) {
      return event.row;
    }
  }
  return null;
}
