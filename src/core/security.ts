/**
 * Security-level figures (story 4-6): one holding across its ISIN history, evaluated per Depot from that
 * Depot's rows of the Security chain and summed for "Alle Depots" (FIFO stays per Depot). Reuses the
 * Depot engine (`core/valuation`, `core/returns`) with the Security's own flows: a BUY is money put into
 * the holding, a SELL or DIVIDEND money taken out. Pure, decimal strings only; nothing here is stored.
 */
import { adjustedPrice, adjustedQuantity, type CorporateActions } from "./corporate-actions";
import { addDays } from "./dates";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { fifo, type FifoLot } from "./fifo";
import { computePositions, type Position } from "./positions";
import { compareObservations, type PriceObservation, type ResolvedPrice, resolvePrice } from "./prices";
import {
  adjustmentTotals,
  type CashFlow,
  type PeriodPerformance,
  periodCashFlows,
  portfolioPerformance,
  ratioString,
  ReturnDecimal,
  ttwror,
  ttwrorIndex,
  xirr,
} from "./returns";
import { periodFlows, type ValuationPoint, type ValuationRow } from "./valuation";

type Decimal = InstanceType<typeof ExactDecimal>;

/**
 * The Security chain of `securityId`: itself plus every Security connected to it by recorded ISIN
 * changes (undirected, transitive), `securityId` first, the rest in discovery order.
 */
export function securityChain(securityId: string, actions: CorporateActions): string[] {
  const chain = [securityId];
  const members = new Set(chain);
  for (let grew = true; grew; ) {
    grew = false;
    for (const change of actions.isinChanges) {
      const hasOld = members.has(change.oldSecurityId);
      const hasNew = members.has(change.newSecurityId);
      if (hasOld === hasNew) continue;
      const added = hasOld ? change.newSecurityId : change.oldSecurityId;
      members.add(added);
      chain.push(added);
      grew = true;
    }
  }
  return chain;
}

/**
 * The Security `securityId` maps to as of `asOf`: follows the ISIN changes dated on or before `asOf`
 * (in their recorded `(date, id)` order) from `securityId` forward.
 */
export function currentSecurityId(securityId: string, actions: CorporateActions, asOf: string): string {
  let current = securityId;
  for (const change of actions.isinChanges) {
    if (change.date <= asOf && change.oldSecurityId === current) current = change.newSecurityId;
  }
  return current;
}

/** A Depot series as the Security's series: `value = positionsValue`, no cash. */
export function securitySeries(points: readonly ValuationPoint[]): ValuationPoint[] {
  return points.map((point) => ({ ...point, value: point.positionsValue, cash: "0" }));
}

function flowRow(row: ValuationRow, type: "DEPOSIT" | "WITHDRAWAL", amount: Decimal): ValuationRow {
  return {
    securityId: null,
    type,
    date: row.date,
    sequence: row.sequence,
    quantity: null,
    amount: canonicalDecimal(amount),
    fee: "0",
    tax: "0",
  };
}

/**
 * The Security's flows as synthetic external-flow rows for `ttwror` / `xirr` / `periodCashFlows`: BUY
 * `DEPOSIT amount + fee`, SELL and DIVIDEND `WITHDRAWAL amount − fee`, FEE `DEPOSIT fee`; taxes are
 * ignored (every synthetic row has `tax` 0), other types give no flow.
 */
export function securityFlowRows(rows: readonly ValuationRow[]): ValuationRow[] {
  const flows: ValuationRow[] = [];
  for (const row of rows) {
    if (row.type === "BUY") flows.push(flowRow(row, "DEPOSIT", new ExactDecimal(row.amount).plus(row.fee)));
    else if (row.type === "SELL" || row.type === "DIVIDEND") {
      flows.push(flowRow(row, "WITHDRAWAL", new ExactDecimal(row.amount).minus(row.fee)));
    } else if (row.type === "FEE") flows.push(flowRow(row, "DEPOSIT", new ExactDecimal(row.fee)));
  }
  return flows;
}

/** Signed flow of a synthetic row into the holding. */
function signedFlow(row: ValuationRow): Decimal {
  return row.type === "DEPOSIT" ? new ExactDecimal(row.amount) : new ExactDecimal(row.amount).negated();
}

/**
 * Period performance of one Depot's holding of the Security chain over the Period covered by `series`
 * (a `securitySeries`), with `start` its point at the end of the day before. `rows` are the Depot's rows
 * of the chain (all dates). realized = FIFO gains of SELLs in the Period; unrealized = Δ(positions value −
 * invested capital); dividends = Σ DIVIDEND `amount`; fees = Σ `fee` of DIVIDEND/FEE rows; taxesPaid =
 * Σ signed `tax` (separate); gain = `V(end) − V(start) − netFlows` = realized + unrealized + dividends −
 * fees. TTWROR and XIRR over the Security flows (`securityFlowRows`). Holding corrections count at their
 * market value (`adjustmentValue` of the series) as flows and leave the unrealized part unchanged.
 */
export function securityPerformance(
  rows: readonly ValuationRow[],
  start: ValuationPoint,
  series: readonly ValuationPoint[],
  actions: CorporateActions,
): PeriodPerformance {
  const end = series.length > 0 ? series[series.length - 1] : start;
  const from = series.length > 0 ? series[0].date : addDays(start.date, 1);
  const to = end.date;
  const inPeriod = rows.filter((row) => row.date >= from && row.date <= to);
  const flows = securityFlowRows(inPeriod);

  // Holding corrections (ADJUSTMENT) are flows at their market value, carried by the series points.
  const adjustments = adjustmentTotals(series);
  let netFlows = adjustments.flows;
  for (const flow of flows) netFlows = netFlows.plus(signedFlow(flow));
  let fees = new ExactDecimal(0);
  for (const row of inPeriod) {
    if (row.type === "FEE" || row.type === "DIVIDEND") fees = fees.plus(row.fee);
  }
  let realized = new ExactDecimal(0);
  if (inPeriod.length > 0) {
    for (const result of fifo(rows, to, actions)) {
      for (const sale of result.sales) {
        if (sale.date >= from && sale.date <= to) realized = realized.plus(sale.gain);
      }
    }
  }
  const unrealizedOf = (point: ValuationPoint) => new ExactDecimal(point.positionsValue).minus(point.investedCapital);
  const unrealized = unrealizedOf(end).minus(unrealizedOf(start)).minus(adjustments.markup);
  const gain = new ExactDecimal(end.value).minus(start.value).minus(netFlows);
  const { dividends, taxesPaid } = periodFlows(rows, from, to);

  return {
    gain: canonicalDecimal(gain),
    realized: canonicalDecimal(realized),
    unrealized: canonicalDecimal(unrealized),
    dividends,
    fees: canonicalDecimal(fees),
    feesContribution: canonicalDecimal(fees.negated()),
    taxesPaid,
    netExternalFlows: canonicalDecimal(netFlows),
    ttwror: ttwror(start, series, flows),
    xirr: series.length > 0 ? xirr(periodCashFlows(flows, start, series)) : null,
  };
}

/** One Depot's Security result as `sumSecurityPerformance` sums it. */
export type SecurityPart = {
  /** The Depot's rows of the chain (ledger rows, not flows). */
  rows: readonly ValuationRow[];
  start: ValuationPoint;
  series: readonly ValuationPoint[];
  performance: PeriodPerformance;
};

/**
 * "Alle Depots": series and start summed pointwise, amounts summed (FIFO stays per Depot), TTWROR and
 * XIRR over the summed series and the merged Security flows (same construction as
 * `portfolioPerformance`). Every part must cover the same dates; throws without parts.
 */
export function sumSecurityPerformance(parts: readonly SecurityPart[]): {
  start: ValuationPoint;
  series: ValuationPoint[];
  performance: PeriodPerformance;
} {
  // The return functions only read flows dated in the Period.
  return portfolioPerformance(parts.map((part) => ({ ...part, rows: securityFlowRows(part.rows) })));
}

/** The holding as of a date, summed over the scope's Depots. */
export type SecuritySnapshot = {
  quantity: string;
  costBasis: string;
  /** `null` when any open Position lacks a price. */
  value: string | null;
  /** `value − costBasis`; `null` without value. */
  unrealized: string | null;
  /** `costBasis / quantity`; `null` when the quantity is 0. */
  averagePrice: string | null;
};

/** Sums the open Positions (`computePositions` per Depot of the scope) into one snapshot. */
export function securitySnapshot(positions: readonly Position[]): SecuritySnapshot {
  let quantity = new ExactDecimal(0);
  let costBasis = new ExactDecimal(0);
  let value: Decimal | null = new ExactDecimal(0);
  for (const position of positions) {
    quantity = quantity.plus(position.quantity);
    costBasis = costBasis.plus(position.costBasis);
    value = value === null || position.value === null ? null : value.plus(position.value);
  }
  return {
    quantity: canonicalDecimal(quantity),
    costBasis: canonicalDecimal(costBasis),
    value: value === null ? null : canonicalDecimal(value),
    unrealized: value === null ? null : canonicalDecimal(value.minus(costBasis)),
    averagePrice: quantity.isZero() ? null : canonicalDecimal(costBasis.dividedBy(quantity)),
  };
}

/** An open FIFO lot with its purchase price per unit (`costBasis / quantity`, units as of the evaluation date). */
export type SecurityLot = FifoLot & { price: string };

/**
 * Open FIFO lots of one Depot's chain rows as of `asOf` (quantity > 0), ordered by `(date, sequence)`,
 * each with its purchase price.
 */
export function securityLots(rows: readonly ValuationRow[], asOf: string, actions: CorporateActions): SecurityLot[] {
  return fifo(rows, asOf, actions)
    .flatMap((result) => result.lots)
    .filter((lot) => new ExactDecimal(lot.quantity).greaterThan(0))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.sequence - b.sequence))
    .map((lot) => ({ ...lot, price: canonicalDecimal(new ExactDecimal(lot.costBasis).dividedBy(lot.quantity)) }));
}

/**
 * The resolver price of `securityId` as of `asOf` over observations adjusted to the Securities and units
 * as of `asOf` (as `computePositions` resolves it); `null` without one.
 */
export function securityPrice(
  observations: readonly PriceObservation[],
  securityId: string,
  actions: CorporateActions,
  asOf: string,
): ResolvedPrice | null {
  return resolvePrice(adjustedObservations(observations, actions, asOf), securityId, asOf);
}

/** Observations carried to the Securities and units as of `asOf` (`adjustedPrice`). */
export function adjustedObservations(
  observations: readonly PriceObservation[],
  actions: CorporateActions,
  asOf: string,
): readonly PriceObservation[] {
  return actions.splits.length === 0 && actions.isinChanges.length === 0
    ? observations
    : observations.map((observation) => ({
        ...observation,
        ...adjustedPrice(observation.securityId, observation.date, observation.price, actions, asOf),
      }));
}

/** The all-time result of the holding since the first buy, as of "today" (story 4-7). Decimal strings. */
export type SecurityTotal = {
  /** Σ FIFO sale gains. */
  realized: string;
  /** Current value − Cost Basis of the open Positions; `null` without a value. */
  unrealized: string | null;
  /** Σ DIVIDEND `amount` (gross). */
  dividends: string;
  /** Σ `fee` of DIVIDEND/FEE rows (trade fees are in cost and proceeds). */
  fees: string;
  /** Σ signed `tax` of all rows; not part of `total`. */
  taxesPaid: string;
  /** realized + unrealized + dividends − fees; `null` without a value. */
  total: string | null;
  /** Σ BUY `amount + fee` plus the Cost Basis positive ADJUSTMENTs add (`quantity × price`). */
  totalInvested: string;
  /** `total / totalInvested`; `null` without a total or when nothing was invested. */
  returnRatio: string | null;
  /** Annualised money-weighted return of the Security flows plus the current value; `null` if unsolvable. */
  xirr: string | null;
  /** Current value of the open Positions; `null` when an open Position lacks a price. */
  value: string | null;
};

/**
 * Investor-view cash flows of the Security rows: BUY −(amount + fee), FEE −fee, SELL and DIVIDEND
 * +(amount − fee); taxes are ignored. An ADJUSTMENT is −(quantity × the resolver price as of its date,
 * adjusted like `computePositions`; 0 without a price).
 */
function investorFlows(
  rows: readonly ValuationRow[],
  observations: readonly PriceObservation[],
  actions: CorporateActions,
): CashFlow[] {
  const flows = securityFlowRows(rows).map((flow) => ({
    date: flow.date,
    amount: canonicalDecimal(signedFlow(flow).negated()),
  }));
  for (const row of rows) {
    if (row.type !== "ADJUSTMENT" || row.securityId === null) continue;
    const price = securityPrice(observations, row.securityId, actions, row.date);
    if (price === null) continue;
    flows.push({ date: row.date, amount: canonicalDecimal(new ExactDecimal(row.quantity ?? "0").times(price.price).negated()) });
  }
  return flows;
}

/**
 * The all-time Security total as of `today` over the scope's Depots (`depotRows`: each Depot's rows of
 * the chain, all dates; FIFO per Depot), summed; XIRR over the merged investor flows plus the summed
 * current value on `today` (when > 0). Independent of any Period. A missing value (open Position
 * without a price) makes unrealized, total, ratio and XIRR `null`.
 */
export function securityTotal(
  depotRows: readonly (readonly ValuationRow[])[],
  observations: readonly PriceObservation[],
  actions: CorporateActions,
  today: string,
): SecurityTotal {
  let realized = new ExactDecimal(0);
  let dividends = new ExactDecimal(0);
  let fees = new ExactDecimal(0);
  let taxesPaid = new ExactDecimal(0);
  let invested = new ExactDecimal(0);
  let costBasis = new ExactDecimal(0);
  let value: Decimal | null = new ExactDecimal(0);
  const flows: CashFlow[] = [];
  for (const rows of depotRows) {
    const upToToday = rows.filter((row) => row.date <= today);
    for (const result of fifo(upToToday, today, actions)) {
      for (const sale of result.sales) realized = realized.plus(sale.gain);
    }
    for (const position of computePositions(upToToday, observations, today, actions)) {
      costBasis = costBasis.plus(position.costBasis);
      value = value === null || position.value === null ? null : value.plus(position.value);
    }
    for (const row of upToToday) {
      if (row.type === "DIVIDEND") dividends = dividends.plus(row.amount);
      if (row.type === "DIVIDEND" || row.type === "FEE") fees = fees.plus(row.fee);
      if (row.type === "BUY") invested = invested.plus(row.amount).plus(row.fee);
      if (row.type === "ADJUSTMENT" && new ExactDecimal(row.quantity ?? "0").isPositive()) {
        invested = invested.plus(new ExactDecimal(row.quantity as string).times(row.price ?? "0"));
      }
      taxesPaid = taxesPaid.plus(row.tax);
    }
    flows.push(...investorFlows(upToToday, observations, actions));
  }

  let unrealized: Decimal | null = null;
  let total: Decimal | null = null;
  let returnRatio: string | null = null;
  let rate: string | null = null;
  if (value !== null) {
    unrealized = value.minus(costBasis);
    total = realized.plus(unrealized).plus(dividends).minus(fees);
    returnRatio = invested.isZero() ? null : canonicalDecimal(total.dividedBy(invested));
    if (value.greaterThan(0)) flows.push({ date: today, amount: canonicalDecimal(value) });
    rate = xirr(flows);
  }
  return {
    realized: canonicalDecimal(realized),
    unrealized: unrealized === null ? null : canonicalDecimal(unrealized),
    dividends: canonicalDecimal(dividends),
    fees: canonicalDecimal(fees),
    taxesPaid: canonicalDecimal(taxesPaid),
    total: total === null ? null : canonicalDecimal(total),
    totalInvested: canonicalDecimal(invested),
    returnRatio,
    xirr: rate,
    value: value === null ? null : canonicalDecimal(value),
  };
}

/** One day of the price chart: the resolver price (decimal string) or `null` before the first one. */
export type PricePoint = { date: string; price: string | null };

/**
 * Daily resolver price of `securityId` for `from..to` (inclusive) over the observations carried to the
 * Securities and units as of `to` (as `securityPrice`), carried forward; `null` before the first
 * observation. One sorted pass instead of resolving each day. Empty when `from > to`.
 */
export function securityPriceSeries(
  observations: readonly PriceObservation[],
  securityId: string,
  actions: CorporateActions,
  from: string,
  to: string,
): PricePoint[] {
  if (from > to) return [];
  const own = adjustedObservations(observations, actions, to)
    .filter((observation) => observation.securityId === securityId && observation.date <= to)
    .sort(compareObservations);
  const points: PricePoint[] = [];
  let next = 0;
  let price: string | null = null;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    while (next < own.length && own[next].date <= day) price = own[next++].price;
    points.push({ date: day, price });
  }
  return points;
}

/** A BUY/SELL row of the Security chain as `securityTrades` needs it. */
export type SecurityTradeRow = ValuationRow & { price: string | null; depotName: string };

/** A trade marker: quantity and price per unit in the price Security's units as of the chart end. */
export type SecurityTrade = {
  depotName: string;
  type: "BUY" | "SELL";
  date: string;
  sequence: number;
  quantity: string;
  price: string;
  /** True when a corporate action changed quantity or price. */
  adjusted: boolean;
};

/**
 * The BUY/SELL rows among `rows` as trade markers, ordered `(date, sequence)`: quantity and price per
 * unit (`price`, else `amount / quantity`) carried to the Security and units as of `asOf`
 * (`adjustedQuantity`, `adjustedPrice`). Rows without a positive quantity are skipped.
 */
export function securityTrades(rows: readonly SecurityTradeRow[], actions: CorporateActions, asOf: string): SecurityTrade[] {
  const trades: SecurityTrade[] = [];
  for (const row of rows) {
    if ((row.type !== "BUY" && row.type !== "SELL") || row.securityId === null || row.quantity === null) continue;
    const quantity = new ExactDecimal(row.quantity);
    if (!quantity.greaterThan(0)) continue;
    const unitPrice = row.price ?? canonicalDecimal(new ExactDecimal(row.amount).dividedBy(quantity));
    const adjustedUnits = adjustedQuantity(row.securityId, row.date, row.quantity, actions, asOf).quantity;
    const adjustedUnitPrice = adjustedPrice(row.securityId, row.date, unitPrice, actions, asOf).price;
    trades.push({
      depotName: row.depotName,
      type: row.type,
      date: row.date,
      sequence: row.sequence,
      quantity: adjustedUnits,
      price: adjustedUnitPrice,
      adjusted:
        !new ExactDecimal(adjustedUnits).equals(quantity) || !new ExactDecimal(adjustedUnitPrice).equals(unitPrice),
    });
  }
  return trades.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.sequence - b.sequence));
}

/** A dividend marker of the Security chain: gross amount (decimal string) and the booking Depot. */
export type SecurityDividend = { depotName: string; date: string; sequence: number; amount: string };

/** The DIVIDEND rows among `rows` as chart markers (gross `amount`), ordered `(date, sequence)`. */
export function securityDividends(rows: readonly SecurityTradeRow[]): SecurityDividend[] {
  return rows
    .filter((row) => row.type === "DIVIDEND")
    .map((row) => ({ depotName: row.depotName, date: row.date, sequence: row.sequence, amount: row.amount }))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.sequence - b.sequence));
}

/** One day of the Security performance line: cumulative TTWROR since the series start (ratio string). */
export type PerformancePoint = { date: string; performance: string };

/**
 * The Security's time-weighted performance line over `series` (a `securitySeries`, or the summed
 * series for "Alle Depots"), `start` the point of the day before: per day the TTWROR index of the
 * Security flows (`securityFlowRows(rows)`) − 1, so buys and sells are flows, never gains. `"0"` before
 * anything is invested. The last point equals the Period TTWROR whenever that is non-null.
 */
export function securityPerformanceLine(
  start: ValuationPoint,
  series: readonly ValuationPoint[],
  rows: readonly ValuationRow[],
): PerformancePoint[] {
  return ttwrorIndex(start, series, securityFlowRows(rows)).map(({ date, level }) => ({
    date,
    performance: ratioString(new ReturnDecimal(level).minus(1)),
  }));
}

/** One day of a moving average: decimal string (10 decimal places, canonical) or `null`. */
export type MovingAveragePoint = { date: string; average: string | null };

/** Decimal places of a moving average. */
const AVERAGE_DECIMALS = 10;

/**
 * Moving average of the stored closes of `securityId` for each day `from..to` (inclusive): stored Prices
 * only (source `provider`/`manual`, never `transaction`), carried to the Securities and units as of `to`
 * (as `securityPriceSeries`, so a split is never a drop); one close per date, the resolver winner of that
 * date (manual > provider). Each day's average is the arithmetic mean of the last `window` closes dated
 * on or before it (history before `from` counts), rounded half-up to 10 decimal places; `null` while
 * fewer than `window` closes exist. Empty when `from > to`.
 */
export function securityMovingAverage(
  observations: readonly PriceObservation[],
  securityId: string,
  actions: CorporateActions,
  from: string,
  to: string,
  window: number,
): MovingAveragePoint[] {
  if (from > to) return [];
  const own = adjustedObservations(
    observations.filter((observation) => observation.source !== "transaction"),
    actions,
    to,
  )
    .filter((observation) => observation.securityId === securityId && observation.date <= to)
    .sort(compareObservations);
  // The last observation of a date is its resolver winner.
  const closes: { date: string; price: string }[] = [];
  for (const observation of own) {
    const last = closes[closes.length - 1];
    if (last && last.date === observation.date) last.price = observation.price;
    else closes.push({ date: observation.date, price: observation.price });
  }

  const points: MovingAveragePoint[] = [];
  let next = 0;
  let sum = new ExactDecimal(0);
  for (let day = from; day <= to; day = addDays(day, 1)) {
    while (next < closes.length && closes[next].date <= day) {
      sum = sum.plus(closes[next].price);
      if (next >= window) sum = sum.minus(closes[next - window].price);
      next++;
    }
    const average =
      next >= window && window > 0
        ? canonicalDecimal(sum.dividedBy(window).toDecimalPlaces(AVERAGE_DECIMALS, ExactDecimal.ROUND_HALF_UP))
        : null;
    points.push({ date: day, average });
  }
  return points;
}

/** Change of the Price over a Period: € per unit (end − base, decimal string) and end ÷ base − 1 (ratio string). */
export type PriceChange = { perUnit: string; ratio: string };

/**
 * The Price change of `securityId` over `from..to` (story 9.2): end = resolver Price as of `to`; base =
 * resolver Price as of `from − 1`, else the first Price dated within `from..to`; both carried to the
 * Securities and units as of `to` (so a split in the Period is neutral). `null` without end or base, or
 * with a base of zero.
 */
export function securityPriceChange(
  observations: readonly PriceObservation[],
  securityId: string,
  actions: CorporateActions,
  from: string,
  to: string,
): PriceChange | null {
  const adjusted = adjustedObservations(observations, actions, to);
  const end = resolvePrice(adjusted, securityId, to);
  if (end === null) return null;
  let base = resolvePrice(adjusted, securityId, addDays(from, -1));
  if (base === null) {
    const first = adjusted
      .filter((observation) => observation.securityId === securityId && observation.date >= from && observation.date <= to)
      .reduce<string | null>((date, observation) => (date === null || observation.date < date ? observation.date : date), null);
    base = first === null ? null : resolvePrice(adjusted, securityId, first);
  }
  if (base === null || new ReturnDecimal(base.price).isZero()) return null;
  return {
    perUnit: canonicalDecimal(new ExactDecimal(end.price).minus(base.price)),
    ratio: ratioString(new ReturnDecimal(end.price).dividedBy(base.price).minus(1)),
  };
}
