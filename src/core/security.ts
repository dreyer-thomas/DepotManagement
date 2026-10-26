/**
 * Security-level figures (story 4-6): one holding across its ISIN history, evaluated per Depot from that
 * Depot's rows of the Security chain and summed for "Alle Depots" (FIFO stays per Depot). Reuses the
 * Depot engine (`core/valuation`, `core/returns`) with the Security's own flows: a BUY is money put into
 * the holding, a SELL or DIVIDEND money taken out. Pure, decimal strings only; nothing here is stored.
 */
import { adjustedPrice, type CorporateActions } from "./corporate-actions";
import { addDays } from "./dates";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { fifo, type FifoLot } from "./fifo";
import type { Position } from "./positions";
import { type PriceObservation, type ResolvedPrice, resolvePrice } from "./prices";
import { type PeriodPerformance, periodCashFlows, portfolioPerformance, ttwror, xirr } from "./returns";
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
 * fees. TTWROR and XIRR over the Security flows (`securityFlowRows`).
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

  let netFlows = new ExactDecimal(0);
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
  const unrealized = unrealizedOf(end).minus(unrealizedOf(start));
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
  const adjusted =
    actions.splits.length === 0 && actions.isinChanges.length === 0
      ? observations
      : observations.map((observation) => ({
          ...observation,
          ...adjustedPrice(observation.securityId, observation.date, observation.price, actions, asOf),
        }));
  return resolvePrice(adjusted, securityId, asOf);
}
