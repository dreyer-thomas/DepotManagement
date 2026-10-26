/**
 * Period performance of a Depot (AD-10): Gain/Loss with its split, TTWROR and XIRR, all derived from one
 * daily valuation series (`core/valuation`) plus the Period's ledger rows. Pure; money stays exact
 * (`ExactDecimal`), return ratios use a lower-precision `decimal.js` clone (logarithms and powers at
 * precision 1000 would be far too slow). Every result is a decimal string; ratios are plain (0.1142 =
 * 11,42 %).
 */
import Decimal from "decimal.js";
import type { CashRow } from "./cash";
import type { CorporateActions } from "./corporate-actions";
import { addDays, daysBetween } from "./dates";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { fifo } from "./fifo";
import { periodFlows, sumValuationSeries, type ValuationPoint, type ValuationRow } from "./valuation";

/** Decimal constructor for return ratios: ≈ 40 significant digits, enough for chained ratios and `ln`/`exp`. */
const ReturnDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type ReturnValue = InstanceType<typeof ReturnDecimal>;
type Exact = InstanceType<typeof ExactDecimal>;

/** Decimal places kept in a returned ratio; far below any displayed precision, above solver noise. */
const RATIO_DECIMALS = 20;

function ratioString(value: ReturnValue): string {
  const rounded = value.toDecimalPlaces(RATIO_DECIMALS, ReturnDecimal.ROUND_HALF_UP);
  return rounded.isZero() ? "0" : rounded.toFixed();
}

/** A ledger row as the external-flow definition needs it. */
export type FlowRow = Pick<CashRow, "type" | "date" | "amount" | "tax">;

function flowOf(row: FlowRow): Exact {
  let flow = new ExactDecimal(row.tax).negated();
  if (row.type === "DEPOSIT") flow = flow.plus(row.amount);
  else if (row.type === "WITHDRAWAL") flow = flow.minus(row.amount);
  return flow;
}

/**
 * Signed external flow of a row into the Depot (AD-10): DEPOSIT `+amount`, WITHDRAWAL `−amount`, and for
 * every row `−tax` (a refund, negative `tax`, is an inflow). Dividends, fees and trades are internal.
 */
export function externalFlow(row: FlowRow): string {
  return canonicalDecimal(flowOf(row));
}

/** Net external flow per date for rows dated `from..to` (inclusive). */
function flowsByDate(rows: readonly FlowRow[], from: string, to: string): Map<string, Exact> {
  const flows = new Map<string, Exact>();
  for (const row of rows) {
    if (row.date < from || row.date > to) continue;
    flows.set(row.date, (flows.get(row.date) ?? new ExactDecimal(0)).plus(flowOf(row)));
  }
  return flows;
}

/** The signed parts of a row's external flow, each classified on its own (a DIVIDEND's tax is an outflow). */
function flowParts(row: FlowRow): Exact[] {
  const parts = [new ExactDecimal(row.tax).negated()];
  if (row.type === "DEPOSIT") parts.push(new ExactDecimal(row.amount));
  else if (row.type === "WITHDRAWAL") parts.push(new ExactDecimal(row.amount).negated());
  return parts;
}

/**
 * Per date (rows dated `from..to`): `inflow` = Σ positive flow parts (Deposits, tax refunds), `outflow` =
 * Σ |negative flow parts| (Withdrawals, taxes paid).
 */
function inOutByDate(rows: readonly FlowRow[], from: string, to: string): Map<string, { inflow: Exact; outflow: Exact }> {
  const flows = new Map<string, { inflow: Exact; outflow: Exact }>();
  for (const row of rows) {
    if (row.date < from || row.date > to) continue;
    let entry = flows.get(row.date);
    if (!entry) flows.set(row.date, (entry = { inflow: new ExactDecimal(0), outflow: new ExactDecimal(0) }));
    for (const part of flowParts(row)) {
      if (part.isPositive() && !part.isZero()) entry.inflow = entry.inflow.plus(part);
      else if (part.isNegative() && !part.isZero()) entry.outflow = entry.outflow.minus(part);
    }
  }
  return flows;
}

/**
 * True time-weighted rate of return over `series` (not annualised). Inflows count at the start of their
 * day, outflows at its end: for each day `d` with previous point `p` (`start` first) `numerator = V(d) +
 * out(d)`, `denominator = V(p) + in(d)`; when `denominator > 0` and `numerator ≥ 0` the chain is
 * multiplied by `numerator / denominator`, otherwise the day is skipped (nothing invested, e.g. after a
 * full Withdrawal, or an overdrawn Depot) — the chain is never reset. `null` when no day was multiplied.
 */
export function ttwror(start: ValuationPoint, series: readonly ValuationPoint[], rows: readonly FlowRow[]): string | null {
  if (series.length === 0) return null;
  const flows = inOutByDate(rows, series[0].date, series[series.length - 1].date);
  let chain = new ReturnDecimal(1);
  let multiplied = false;
  let previous = start;
  for (const point of series) {
    const flow = flows.get(point.date);
    const numerator = new ExactDecimal(point.value).plus(flow?.outflow ?? 0);
    const denominator = new ExactDecimal(previous.value).plus(flow?.inflow ?? 0);
    if (denominator.greaterThan(0) && !numerator.isNegative()) {
      chain = chain.times(new ReturnDecimal(numerator.toFixed()).dividedBy(new ReturnDecimal(denominator.toFixed())));
      multiplied = true;
    }
    previous = point;
  }
  return multiplied ? ratioString(chain.minus(1)) : null;
}

/** A dated cash flow from the investor's view: negative = paid in, positive = received. */
export type CashFlow = { date: string; amount: string };

const MAX_ITERATIONS = 200;
/** Relative tolerance on the rate: far below the displayed two decimals of a percentage. */
const TOLERANCE = new ReturnDecimal("1e-12");
/** Bracket grid towards large rates: 0.5, 1, 3, 10, then ×100 up to 1e100 (very short Periods annualise steeply). */
const RIGHT_GRID = ["0", "0.5", "1", "3", "10", ...Array.from({ length: 50 }, (_, i) => `1e${2 * i + 2}`)];
/**
 * Bracket grid towards −1: −0.5, −0.9, then `1 + r` = 1e-2, 1e-4, … 1e-38 (steep losses over short Periods);
 * 38 nines still fit the 40-digit precision without rounding to −1.
 */
const LEFT_GRID = ["0", "-0.5", "-0.9", ...Array.from({ length: 19 }, (_, i) => `-0.${"9".repeat(2 * i + 2)}`)];

/**
 * True when `step` is below the tolerance relative to the rate's scale: `max(|r|, 1)` for gains, `1 + r`
 * for losses (near −1 the growth factor `1 + r` itself is tiny and must stay accurate).
 */
function converged(step: ReturnValue, r: ReturnValue): boolean {
  const scale = r.isNegative() ? r.plus(1) : ReturnDecimal.max(r, 1);
  return step.abs().lessThanOrEqualTo(TOLERANCE.times(scale));
}

/**
 * Annualised money-weighted rate of return: the `r > −1` with Σ `amount · (1 + r)^(−days/365)` = 0,
 * `days` counted from the earliest flow's date. Newton's method safeguarded by bisection inside a
 * bracket found by expanding outward from 0 (towards −1 down to `1 + r` = 1e-38 and towards large rates up
 * to 1e100); deterministic, bounded iterations, converged to a relative 1e-12 on the rate. The grids are
 * walked alternately by index — the next right interval, then the next left one — and the first interval
 * with a sign change is solved; with several roots, that interval's root wins. `null` when the flows lack a positive or a negative amount, or no
 * sign change (root) is found.
 */
export function xirr(flows: readonly CashFlow[]): string | null {
  const relevant = flows.filter((flow) => !new ReturnDecimal(flow.amount).isZero());
  if (!relevant.some((flow) => new ReturnDecimal(flow.amount).isPositive())) return null;
  if (!relevant.some((flow) => new ReturnDecimal(flow.amount).isNegative())) return null;
  const origin = relevant.reduce((first, flow) => (flow.date < first ? flow.date : first), relevant[0].date);
  // Flows on one date are summed: fewer `exp` evaluations for a long Period.
  const byDate = new Map<number, ReturnValue>();
  for (const flow of relevant) {
    const days = daysBetween(origin, flow.date);
    byDate.set(days, (byDate.get(days) ?? new ReturnDecimal(0)).plus(flow.amount));
  }
  const terms = [...byDate].map(([days, amount]) => ({ amount, years: new ReturnDecimal(days).dividedBy(365) }));
  if (terms.length < 2) return null;

  /** Net present value and its derivative at rate `r`. */
  const evaluate = (r: ReturnValue): { value: ReturnValue; slope: ReturnValue } => {
    const base = r.plus(1);
    const lnBase = base.ln();
    let value = new ReturnDecimal(0);
    let slope = new ReturnDecimal(0);
    for (const term of terms) {
      const discounted = term.years.isZero() ? term.amount : term.amount.times(term.years.times(lnBase).negated().exp());
      value = value.plus(discounted);
      slope = slope.minus(term.years.times(discounted).dividedBy(base));
    }
    return { value, slope };
  };

  // Bracket: grid points expanding outward from 0, nearest intervals first.
  const right = RIGHT_GRID.map((r) => new ReturnDecimal(r));
  const left = LEFT_GRID.map((r) => new ReturnDecimal(r));
  const atZero = evaluate(right[0]).value;
  if (atZero.isZero()) return "0";
  let bracket: [ReturnValue, ReturnValue, ReturnValue] | null = null; // [low, high, value at low]
  let rightValue = atZero;
  let leftValue = atZero;
  for (let step = 1; bracket === null && (step < right.length || step < left.length); step++) {
    if (step < right.length) {
      const value = evaluate(right[step]).value;
      if (value.isZero()) return ratioString(right[step]);
      if (value.isNegative() !== rightValue.isNegative()) bracket = [right[step - 1], right[step], rightValue];
      rightValue = value;
    }
    if (bracket === null && step < left.length) {
      const value = evaluate(left[step]).value;
      if (value.isZero()) return ratioString(left[step]);
      if (value.isNegative() !== leftValue.isNegative()) bracket = [left[step], left[step - 1], value];
      leftValue = value;
    }
  }
  if (bracket === null) return null;

  let [low, high, lowValue] = bracket;
  let r = low.plus(high).dividedBy(2);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const { value, slope } = evaluate(r);
    if (value.isZero()) return ratioString(r);
    if (value.isNegative() === lowValue.isNegative()) {
      low = r;
      lowValue = value;
    } else {
      high = r;
    }
    let next = slope.isZero() ? null : r.minus(value.dividedBy(slope));
    if (next === null || !next.greaterThan(low) || !next.lessThan(high)) next = low.plus(high).dividedBy(2);
    if (converged(next.minus(r), next) || converged(high.minus(low), next)) return ratioString(next);
    r = next;
  }
  return ratioString(r);
}

/**
 * The XIRR cash flows of the Period covered by `series` (investor's view): the start value paid in on
 * `start.date`, the net external flows of rows dated in the Period per date (Deposits paid in,
 * Withdrawals and net taxes received), and the end value received on the Period end.
 */
export function periodCashFlows(rows: readonly FlowRow[], start: ValuationPoint, series: readonly ValuationPoint[]): CashFlow[] {
  const end = series.length > 0 ? series[series.length - 1] : start;
  const from = series.length > 0 ? series[0].date : addDays(start.date, 1);
  const to = end.date;
  const cashFlows: CashFlow[] = [{ date: start.date, amount: canonicalDecimal(new ExactDecimal(start.value).negated()) }];
  for (const [date, flow] of [...flowsByDate(rows, from, to)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!flow.isZero()) cashFlows.push({ date, amount: canonicalDecimal(flow.negated()) });
  }
  cashFlows.push({ date: to, amount: end.value });
  return cashFlows;
}

/** Period Gain/Loss, its split and both return metrics; amounts and ratios as decimal strings. */
export type PeriodPerformance = {
  /** `V(to) − V(start) − netExternalFlows` = realized + unrealized + dividends − fees. */
  gain: string;
  /** FIFO gains of SELLs dated in the Period. */
  realized: string;
  /** Change of (Positions value − invested capital) from start to the Period end. */
  unrealized: string;
  /** Gross DIVIDEND amounts. */
  dividends: string;
  /** Fees of FEE and DIVIDEND rows (trade fees sit in realized/unrealized). */
  fees: string;
  /** The fees' signed contribution to the gain (`−fees`), as the breakdown shows it. */
  feesContribution: string;
  /** Net taxes (paid minus refunds); external, not part of the gain. */
  taxesPaid: string;
  /** Σ external flows (Deposits − Withdrawals − net taxes). */
  netExternalFlows: string;
  /** Not annualised; `null` when nothing was invested. */
  ttwror: string | null;
  /** Annualised; `null` when not solvable. */
  xirr: string | null;
};

/**
 * Performance of the Period covered by `series` (`from..to`), with `start` the valuation point at the
 * end of the day before `from` (zero before the Depot's first row). Rows are all of the Depot's ledger
 * rows; only those dated `from..to` count as Period activity. Exact identity:
 * `gain = realized + unrealized + dividends − fees`.
 */
export function periodPerformance(
  rows: readonly ValuationRow[],
  start: ValuationPoint,
  series: readonly ValuationPoint[],
  actions: CorporateActions,
): PeriodPerformance {
  const end = series.length > 0 ? series[series.length - 1] : start;
  const from = series.length > 0 ? series[0].date : addDays(start.date, 1);
  const to = end.date;
  const inPeriod = rows.filter((row) => row.date >= from && row.date <= to);

  let netExternalFlows = new ExactDecimal(0);
  let fees = new ExactDecimal(0);
  for (const row of inPeriod) {
    netExternalFlows = netExternalFlows.plus(flowOf(row));
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
  const gain = new ExactDecimal(end.value).minus(start.value).minus(netExternalFlows);
  const { dividends, taxesPaid } = periodFlows(rows, from, to);

  return {
    gain: canonicalDecimal(gain),
    realized: canonicalDecimal(realized),
    unrealized: canonicalDecimal(unrealized),
    dividends,
    fees: canonicalDecimal(fees),
    feesContribution: canonicalDecimal(fees.negated()),
    taxesPaid,
    netExternalFlows: canonicalDecimal(netExternalFlows),
    ttwror: ttwror(start, series, rows),
    xirr: series.length > 0 ? xirr(periodCashFlows(rows, start, series)) : null,
  };
}

/** One Depot's Period result as `portfolioPerformance` sums it: its rows, start point, series and performance. */
export type PerformancePart = {
  rows: readonly ValuationRow[];
  start: ValuationPoint;
  series: readonly ValuationPoint[];
  performance: PeriodPerformance;
};

const AMOUNT_FIELDS = [
  "gain",
  "realized",
  "unrealized",
  "dividends",
  "fees",
  "feesContribution",
  "taxesPaid",
  "netExternalFlows",
] as const;

/**
 * Portfolio performance over one common Period (AD-10): the Depots' series and start points summed
 * pointwise, their Gain/Loss and split summed (FIFO stays per Depot), TTWROR chained over the summed
 * series with all Depots' external flows and XIRR over the summed start and end values and the merged
 * flows (same construction as `periodPerformance`). Every part must cover the same dates; throws
 * without parts.
 */
export function portfolioPerformance(parts: readonly PerformancePart[]): {
  start: ValuationPoint;
  series: ValuationPoint[];
  performance: PeriodPerformance;
} {
  if (parts.length === 0) throw new Error("portfolioPerformance needs at least one part");
  const [start] = sumValuationSeries(parts.map((part) => [part.start]));
  const series = sumValuationSeries(parts.map((part) => part.series));
  const rows = parts.flatMap((part) => part.rows);
  const sums = {} as Record<(typeof AMOUNT_FIELDS)[number], string>;
  for (const field of AMOUNT_FIELDS) {
    sums[field] = canonicalDecimal(parts.reduce((sum, part) => sum.plus(part.performance[field]), new ExactDecimal(0)));
  }
  return {
    start,
    series,
    performance: {
      ...sums,
      ttwror: ttwror(start, series, rows),
      xirr: series.length > 0 ? xirr(periodCashFlows(rows, start, series)) : null,
    },
  };
}
