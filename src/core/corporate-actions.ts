/**
 * Corporate actions on read (AD-7, AD-8). Pure, decimal strings only. Stored Transactions and Prices
 * are never modified; every quantity/price consumer in core goes through this file.
 *
 * - A split `old:new` of a Security dated D scales every quantity of that Security held before D by
 *   `new/old` (and per-unit prices by `old/new`).
 * - An ISIN change A→B dated D (old quantity `o`, new quantity `n`) moves A's open FIFO lots into B,
 *   keeping their original `(date, sequence)` and Cost Basis, quantities × `n/o`; A then holds nothing.
 *
 * An action dated D affects only rows dated before D. On one date, splits apply first, then ISIN
 * changes (in the order given), then Transactions by sequence. Quantities stay exact: the replay works
 * on scaled quantities (multiplication only) with one divisor per Security, divided once on output.
 */
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { compareLedgerOrder, type LedgerOrdered } from "./ledger-order";

type Decimal = InstanceType<typeof ExactDecimal>;

/** A stock split of one Security; ratio terms are positive integer strings (`old:new`, e.g. `1:4`). */
export type Split = { securityId: string; date: string; ratioOld: string; ratioNew: string };

/** An ISIN change: `oldQuantity` units of the old Security became `newQuantity` units of the new one. */
export type IsinChange = {
  oldSecurityId: string;
  newSecurityId: string;
  date: string;
  oldQuantity: string;
  newQuantity: string;
};

/** Every recorded corporate action; ISIN changes ordered by `(date, id)` (same-date order matters). */
export type CorporateActions = { splits: readonly Split[]; isinChanges: readonly IsinChange[] };

export const NO_CORPORATE_ACTIONS: CorporateActions = { splits: [], isinChanges: [] };

/** "All actions": the asOf that includes every recorded corporate action (used by holding guards). */
export const ALL_ACTIONS = "9999-12-31";

const RATIO_TERM = "([1-9]\\d{0,5})";
const RATIO = new RegExp(`^\\s*${RATIO_TERM}\\s*:\\s*${RATIO_TERM}\\s*$`);

/**
 * Parses ratio text such as `1:4`, `1 : 4` or `10:1` into canonical terms. Both terms are positive
 * integers without leading zeros (at most 6 digits) and differ; anything else is `null`.
 */
export function parseSplitRatio(text: unknown): { ratioOld: string; ratioNew: string } | null {
  if (typeof text !== "string") return null;
  const match = RATIO.exec(text);
  if (!match || match[1] === match[2]) return null;
  return { ratioOld: match[1], ratioNew: match[2] };
}

/** `Πnew` / `Πold` of the splits that adjust a row of `securityId` dated `date` as of `asOf`; `null` when none. */
function splitFactor(
  securityId: string,
  date: string,
  splits: readonly Split[],
  asOf: string,
): { num: Decimal; den: Decimal } | null {
  let num = new ExactDecimal(1);
  let den = new ExactDecimal(1);
  let applies = false;
  for (const split of splits) {
    if (split.securityId !== securityId || !(date < split.date) || split.date > asOf) continue;
    num = num.times(split.ratioNew);
    den = den.times(split.ratioOld);
    applies = true;
  }
  return applies ? { num, den } : null;
}

/**
 * A quantity of `securityId` booked on `date`, split-adjusted as of `asOf` (splits only; for display
 * and sale quantities); `null` when no split applies.
 */
export function splitAdjustment(
  securityId: string,
  date: string,
  quantity: string,
  splits: readonly Split[],
  asOf: string,
): string | null {
  const factor = splitFactor(securityId, date, splits, asOf);
  return factor ? canonicalDecimal(new ExactDecimal(quantity).times(factor.num).dividedBy(factor.den)) : null;
}

/** An action event in replay order. */
export type ActionEvent = { kind: "split"; split: Split } | { kind: "isin-change"; change: IsinChange };

/** A row the replay consumes: BUY/SELL with a Security take part, everything else is skipped. */
export type ReplayRow = LedgerOrdered & { securityId: string | null; type: string; quantity: string | null };

export type ReplayEvent<T extends ReplayRow> = ActionEvent | { kind: "trade"; row: T };

export function eventDate(event: ReplayEvent<ReplayRow>): string {
  if (event.kind === "split") return event.split.date;
  if (event.kind === "isin-change") return event.change.date;
  return event.row.date;
}

const KIND_RANK = { split: 0, "isin-change": 1, trade: 2 } as const;

/** Actions dated on or before `asOf` in replay order: by date, splits before ISIN changes, then given order. */
export function actionEvents(actions: CorporateActions, asOf: string): ActionEvent[] {
  const events: ActionEvent[] = [
    ...actions.splits.filter((split) => split.date <= asOf).map((split) => ({ kind: "split" as const, split })),
    ...actions.isinChanges
      .filter((change) => change.date <= asOf)
      .map((change) => ({ kind: "isin-change" as const, change })),
  ];
  return stableSort(events, (a, b) => compareEvents(a, b));
}

function compareEvents(a: ReplayEvent<ReplayRow>, b: ReplayEvent<ReplayRow>): number {
  const dateA = eventDate(a);
  const dateB = eventDate(b);
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (a.kind === "trade" && b.kind === "trade") return a.row.sequence - b.row.sequence;
  return 0;
}

function stableSort<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * The chronological event stream of one Depot: actions and BUY/SELL rows with a Security, both dated
 * on or before `asOf`, ordered by date, then splits, ISIN changes, Transactions (by sequence).
 */
export function replayEvents<T extends ReplayRow>(
  rows: readonly T[],
  actions: CorporateActions,
  asOf: string,
): ReplayEvent<T>[] {
  const trades = rows
    .filter((row) => row.securityId !== null && (row.type === "BUY" || row.type === "SELL") && row.date <= asOf)
    .map((row) => ({ kind: "trade" as const, row }));
  return stableSort<ReplayEvent<T>>([...actionEvents(actions, asOf), ...trades], compareEvents);
}

/** An open lot in the book; `quantity` is scaled (actual quantity = quantity ÷ the Security's divisor). */
export type BookLot = { date: string; sequence: number; quantity: Decimal; costBasis: Decimal };

type SecurityBook = {
  /** Actual quantity = scaled ÷ divisor. */
  divisor: Decimal;
  lots: BookLot[];
  /** Scaled units sold beyond the open lots (never filled by later BUYs; counts against net holding). */
  short: Decimal;
};

/**
 * FIFO lot book over a replay: per Security an ordered lot queue in an exact scaled basis. Apply events
 * in replay order; read lots, net holdings and the divisor between events.
 */
export class LotBook {
  private readonly books = new Map<string, SecurityBook>();

  private book(securityId: string): SecurityBook {
    let book = this.books.get(securityId);
    if (!book) {
      book = { divisor: new ExactDecimal(1), lots: [], short: new ExactDecimal(0) };
      this.books.set(securityId, book);
    }
    return book;
  }

  /** Security ids in the order they first appeared in the book. */
  securityIds(): string[] {
    return [...this.books.keys()];
  }

  /** The scaled-basis divisor of `securityId` (scaled ÷ divisor = actual quantity). */
  divisor(securityId: string): Decimal {
    return this.books.get(securityId)?.divisor ?? new ExactDecimal(1);
  }

  /** Open lots of `securityId` (scaled quantities), FIFO order. */
  lots(securityId: string): readonly BookLot[] {
    return this.books.get(securityId)?.lots ?? [];
  }

  /** Net held quantity (open lots − oversold units) of `securityId` as `scaled / divisor`. */
  net(securityId: string): { scaled: Decimal; divisor: Decimal } {
    const book = this.books.get(securityId);
    if (!book) return { scaled: new ExactDecimal(0), divisor: new ExactDecimal(1) };
    const total = book.lots.reduce((sum, lot) => sum.plus(lot.quantity), new ExactDecimal(0));
    return { scaled: total.minus(book.short), divisor: book.divisor };
  }

  /** Applies a split: quantities × new, divisor × old (exact). */
  split(split: Split): void {
    const book = this.books.get(split.securityId);
    if (!book) return;
    for (const lot of book.lots) lot.quantity = lot.quantity.times(split.ratioNew);
    book.short = book.short.times(split.ratioNew);
    book.divisor = book.divisor.times(split.ratioOld);
  }

  /** Moves the old Security's lots (and oversold units) into the new Security, quantities × n/o. */
  isinChange(change: IsinChange): void {
    const source = this.books.get(change.oldSecurityId);
    if (!source || (source.lots.length === 0 && source.short.isZero())) return;
    if (change.oldSecurityId === change.newSecurityId) return;
    const target = this.book(change.newSecurityId);
    // moved actual = scaled_A / D_A × n / o
    const sourceDivisor = source.divisor.times(change.oldQuantity);
    if (target.lots.length === 0 && target.short.isZero()) {
      target.divisor = sourceDivisor;
      target.lots = source.lots.map((lot) => ({ ...lot, quantity: lot.quantity.times(change.newQuantity) }));
      target.short = source.short.times(change.newQuantity);
    } else {
      const sourceScale = target.divisor.times(change.newQuantity);
      const targetScale = sourceDivisor;
      const moved = source.lots.map((lot) => ({ ...lot, quantity: lot.quantity.times(sourceScale) }));
      for (const lot of target.lots) lot.quantity = lot.quantity.times(targetScale);
      target.lots = stableSort([...target.lots, ...moved], compareLedgerOrder);
      target.short = target.short.times(targetScale).plus(source.short.times(sourceScale));
      target.divisor = target.divisor.times(targetScale);
    }
    source.lots = [];
    source.short = new ExactDecimal(0);
    source.divisor = new ExactDecimal(1);
  }

  /** Adds a lot of `quantity` (actual units as of now) costing `costBasis`. */
  buy(securityId: string, date: string, sequence: number, quantity: string, costBasis: Decimal): void {
    const book = this.book(securityId);
    const scaled = new ExactDecimal(quantity).times(book.divisor);
    if (scaled.greaterThan(0)) book.lots.push({ date, sequence, quantity: scaled, costBasis });
  }

  /**
   * Consumes `quantity` (actual units as of now) from the earliest lots; returns the consumed Cost Basis.
   * A partially consumed lot gives up `cost × taken / quantity`; units beyond the open lots cost zero.
   */
  sell(securityId: string, quantity: string): Decimal {
    const book = this.book(securityId);
    let remaining = new ExactDecimal(quantity).times(book.divisor);
    let costBasis = new ExactDecimal(0);
    while (remaining.greaterThan(0) && book.lots.length > 0) {
      const lot = book.lots[0];
      if (remaining.greaterThanOrEqualTo(lot.quantity)) {
        costBasis = costBasis.plus(lot.costBasis);
        remaining = remaining.minus(lot.quantity);
        book.lots.shift();
      } else {
        const taken = lot.costBasis.times(remaining).dividedBy(lot.quantity);
        costBasis = costBasis.plus(taken);
        lot.costBasis = lot.costBasis.minus(taken);
        lot.quantity = lot.quantity.minus(remaining);
        remaining = new ExactDecimal(0);
      }
    }
    if (remaining.greaterThan(0)) book.short = book.short.plus(remaining);
    return costBasis;
  }

  /** Applies an action event. */
  apply(event: ActionEvent): void {
    if (event.kind === "split") this.split(event.split);
    else this.isinChange(event.change);
  }
}

/**
 * A per-unit price of `securityId` observed on `date`, carried to the Security and units it maps to as
 * of `asOf`: each later split of the current Security × old/new; each later ISIN change of it moves to
 * the new Security, × o/n.
 */
export function adjustedPrice(
  securityId: string,
  date: string,
  price: string,
  actions: CorporateActions,
  asOf: string,
): { securityId: string; price: string } {
  let current = securityId;
  let num = new ExactDecimal(price);
  let den = new ExactDecimal(1);
  let changed = false;
  for (const event of actionEvents(actions, asOf)) {
    if (event.kind === "split") {
      if (event.split.securityId !== current || !(date < event.split.date)) continue;
      num = num.times(event.split.ratioOld);
      den = den.times(event.split.ratioNew);
      changed = true;
    } else {
      if (event.change.oldSecurityId !== current || !(date < event.change.date)) continue;
      current = event.change.newSecurityId;
      num = num.times(event.change.oldQuantity);
      den = den.times(event.change.newQuantity);
      changed = true;
    }
  }
  return { securityId: current, price: changed ? canonicalDecimal(num.dividedBy(den)) : price };
}

/** Decimal places of a stored (unadjusted) provider Price. */
export const STORED_PRICE_DECIMALS = 4;

/**
 * Undoes provider split adjustment (AD-9): a split-adjusted close of `securityId` on `date` back to the
 * as-traded close — × `new/old` of every recorded split of that Security dated after `date` — rounded
 * half-up to 4 decimal places (always, also without a split).
 */
export function unadjustSplitPrice(securityId: string, date: string, price: string, splits: readonly Split[]): string {
  let value = new ExactDecimal(price);
  for (const split of splits) {
    if (split.securityId !== securityId || !(date < split.date)) continue;
    value = value.times(split.ratioNew).dividedBy(split.ratioOld);
  }
  return canonicalDecimal(value.toDecimalPlaces(STORED_PRICE_DECIMALS, ExactDecimal.ROUND_HALF_UP));
}
