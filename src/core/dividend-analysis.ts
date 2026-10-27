/**
 * Dividend analysis (FR-22, story 7.5). Pure, decimal strings only; "today" is passed in.
 *
 * A payment is a DIVIDEND row with a Security: gross = `amount`, net = `amount − tax − fee` of that row
 * (a negative tax, i.e. a refund, raises net). Standalone TAX/FEE rows are not attributed to dividends.
 * Trailing income uses the "1J" Period (`core/period`), so its gross equals the Period dividends of
 * `core/valuation` `periodFlows`. The estimate repeats every payment of the last 12 months one year
 * later, scaled to today's holding.
 *
 * Story 7.7 adds the per-Security split of every month, cumulative January–December lines per year, a
 * current-year forecast from the estimate and per-Security trailing income with yield on cost
 * (trailing ÷ today's Cost Basis).
 */
import { adjustedQuantity, type CorporateActions } from "./corporate-actions";
import { addMonths } from "./dates";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { fifo } from "./fifo";
import type { GainsRow } from "./gains-analysis";
import { compareLedgerOrder } from "./ledger-order";
import { resolvePeriod } from "./period";
import { ratioString, ReturnDecimal } from "./returns";

type Decimal = InstanceType<typeof ExactDecimal>;

/** Today's Position of a Depot as the dividend analysis needs it (units as of today). */
export type DividendPosition = { securityId: string; quantity: string; value: string | null; costBasis: string };

export type DividendDepotInput = { depotId: string; rows: readonly GainsRow[]; positions: readonly DividendPosition[] };

/** One month (`YYYY-MM`) or year (`YYYY`); amounts as decimal strings. */
export type DividendBucket = { period: string; gross: string; net: string };

/** All-time payments of one Security as booked (Portfolio: summed across Depots). */
export type DividendSecurity = {
  securityId: string;
  count: number;
  gross: string;
  net: string;
  lastDate: string;
  /** Its payments in the "1J" window, as booked. */
  trailingGross: string;
  trailingNet: string;
  /** Σ Cost Basis of today's Positions (quantity > 0) of this Security id in scope; `null` when none. */
  costBasis: string | null;
  /** trailing ÷ costBasis; `null` when `costBasis` is `null` or 0. */
  grossYieldOnCost: string | null;
  netYieldOnCost: string | null;
};

/** The Securities paid in one month (`YYYY-MM`), in `bySecurity` order; Σ = the month bucket. */
export type DividendMonthSplit = { period: string; securities: { securityId: string; gross: string; net: string }[] };

/** Running total from January through each month; `null` for months after today's month. */
export type DividendYearPoint = { gross: string; net: string } | null;

/** Cumulative January–December line of one year (12 points). */
export type DividendYearLine = { year: string; points: DividendYearPoint[] };

export type DividendTrailing = {
  /** The "1J" Period, inclusive. */
  from: string;
  to: string;
  gross: string;
  net: string;
  /** Σ today's values of the paying Positions. */
  payingValue: string;
  /** income ÷ payingValue; `null` without a paying Position, with a value of 0 or an unpriced one. */
  grossYield: string | null;
  netYield: string | null;
};

/** One expected payment: a payment of the last 12 months, one year later, at today's holding. */
export type ExpectedDividend = {
  depotId: string;
  /** Today's Security (splits and ISIN changes followed). */
  securityId: string;
  date: string;
  /** Date of the payment it is based on. */
  basedOn: string;
  gross: string;
  net: string;
};

export type DividendAnalysis = {
  months: DividendBucket[];
  years: DividendBucket[];
  /** Running total of the years (ascending). */
  cumulative: DividendBucket[];
  bySecurity: DividendSecurity[];
  trailing: DividendTrailing;
  expected: ExpectedDividend[];
  /** Expected payments per month, from today's month to the month of today + 12 months. */
  expectedMonths: DividendBucket[];
  /** Per-Security split, aligned 1:1 with `months`. */
  monthsBySecurity: DividendMonthSplit[];
  /** One cumulative January–December line per year of `years`. */
  yearLines: DividendYearLine[];
  /**
   * Today's year, 12 entries: `null` before today's month; from today's month on, the running total
   * through today plus the expected payments dated after today through the end of that month (estimate).
   */
  forecast: DividendYearPoint[];
};

type Amounts = { gross: Decimal; net: Decimal };

const zero = (): Amounts => ({ gross: new ExactDecimal(0), net: new ExactDecimal(0) });
const add = (a: Amounts, b: Amounts): Amounts => ({ gross: a.gross.plus(b.gross), net: a.net.plus(b.net) });
const bucket = (period: string, amounts: Amounts): DividendBucket => ({
  period,
  gross: canonicalDecimal(amounts.gross),
  net: canonicalDecimal(amounts.net),
});

const bucketAmounts = (amounts: Amounts) => ({ gross: canonicalDecimal(amounts.gross), net: canonicalDecimal(amounts.net) });

const monthKey = (year: number, month: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

/** Every `YYYY-MM` from `first` to `last` (inclusive). */
function monthRange(first: string, last: string): string[] {
  const keys: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  for (let key = monthKey(year, month); key <= last; key = monthKey(year, month)) {
    keys.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

/** Gross and net of a DIVIDEND row. */
function paymentAmounts(row: GainsRow): Amounts {
  const gross = new ExactDecimal(row.amount);
  return { gross, net: gross.minus(row.tax).minus(row.fee) };
}

const isPayment = (row: GainsRow) => row.type === "DIVIDEND" && row.securityId !== null;

/** Units of `securityId` held in a Depot just before `payment` (FIFO over earlier rows), in today's units. */
function heldAtPayment(rows: readonly GainsRow[], payment: GainsRow, actions: CorporateActions, today: string): Decimal {
  const securityId = payment.securityId as string;
  const before = rows.filter((row) => compareLedgerOrder(row, payment) < 0);
  const result = fifo(before, payment.date, actions).find((entry) => entry.securityId === securityId);
  const held = (result?.lots ?? []).reduce((sum, lot) => sum.plus(lot.quantity), new ExactDecimal(0));
  return new ExactDecimal(adjustedQuantity(securityId, payment.date, canonicalDecimal(held), actions, today).quantity);
}

/**
 * The current-year forecast: `null` before today's month; month m ≥ today's month = `yearToDate`
 * (today's year through today) + the expected payments dated in (today, end of m] of today's year.
 */
function forecastOf(today: string, yearToDate: Amounts, expected: readonly ExpectedDividend[]): DividendYearPoint[] {
  const year = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));
  let total = yearToDate;
  return Array.from({ length: 12 }, (_, i): DividendYearPoint => {
    const key = monthKey(year, i + 1);
    if (i + 1 < todayMonth) return null;
    for (const payment of expected) {
      if (payment.date > today && payment.date.slice(0, 7) === key) {
        total = add(total, { gross: new ExactDecimal(payment.gross), net: new ExactDecimal(payment.net) });
      }
    }
    return bucketAmounts(total);
  });
}

const EMPTY_TRAILING = (from: string, to: string): DividendTrailing => ({
  from,
  to,
  gross: "0",
  net: "0",
  payingValue: "0",
  grossYield: null,
  netYield: null,
});

/**
 * Dividends of the Depots in scope: buckets per month (first ledger month to today's month) and year
 * (first ledger year to today's year; a year = Σ its months), the running total per year, all-time totals
 * per Security (gross descending, then Security id), trailing-12-month income and yield over the "1J"
 * Period and the next 12 months' estimate. Rows dated after `today` are ignored; `positions` are each
 * Depot's Positions as of today. Empty buckets and lists without rows.
 */
export function dividendAnalysis(depots: readonly DividendDepotInput[], actions: CorporateActions, today: string): DividendAnalysis {
  const { from, to } = resolvePeriod({ kind: "preset", preset: "1J" }, today, null);
  const scoped = depots.map((depot) => ({ ...depot, rows: depot.rows.filter((row) => row.date <= today) }));
  const allRows = scoped.flatMap((depot) => depot.rows);
  if (allRows.length === 0) {
    return {
      months: [],
      years: [],
      cumulative: [],
      bySecurity: [],
      trailing: EMPTY_TRAILING(from, to),
      expected: [],
      expectedMonths: [],
      monthsBySecurity: [],
      yearLines: [],
      forecast: forecastOf(today, zero(), []),
    };
  }

  const firstMonth = allRows.reduce((first, row) => (row.date < first ? row.date : first), allRows[0].date).slice(0, 7);
  const months = new Map<string, Amounts>(monthRange(firstMonth, today.slice(0, 7)).map((key) => [key, zero()]));
  const securities = new Map<string, { count: number; amounts: Amounts; lastDate: string; trailing: Amounts }>();
  const split = new Map<string, Map<string, Amounts>>();
  const costBases = new Map<string, Decimal>();
  let trailing = zero();
  let payingValue = new ExactDecimal(0);
  let paying = 0;
  let unpriced = false;
  const expected: ExpectedDividend[] = [];

  for (const depot of scoped) {
    const positions = new Map(depot.positions.map((position) => [position.securityId, position]));
    for (const position of depot.positions) {
      if (!new ExactDecimal(position.quantity).greaterThan(0)) continue;
      costBases.set(position.securityId, (costBases.get(position.securityId) ?? new ExactDecimal(0)).plus(position.costBasis));
    }
    const payingIds = new Set<string>();
    for (const row of depot.rows) {
      if (!isPayment(row)) continue;
      const securityId = row.securityId as string;
      const amounts = paymentAmounts(row);
      const key = row.date.slice(0, 7);
      months.set(key, add(months.get(key) as Amounts, amounts));
      const monthSplit = split.get(key) ?? new Map<string, Amounts>();
      monthSplit.set(securityId, add(monthSplit.get(securityId) ?? zero(), amounts));
      split.set(key, monthSplit);

      const inTrailing = row.date >= from && row.date <= to;
      const entry = securities.get(securityId) ?? { count: 0, amounts: zero(), lastDate: row.date, trailing: zero() };
      securities.set(securityId, {
        count: entry.count + 1,
        amounts: add(entry.amounts, amounts),
        lastDate: row.date > entry.lastDate ? row.date : entry.lastDate,
        trailing: inTrailing ? add(entry.trailing, amounts) : entry.trailing,
      });

      if (!inTrailing) continue;
      trailing = add(trailing, amounts);
      const current = adjustedQuantity(securityId, row.date, "0", actions, today).securityId;
      payingIds.add(current);

      // Estimate window (from, today]: a payment exactly one year ago is not projected onto today.
      const position = positions.get(current);
      if (row.date === from || !position || !new ExactDecimal(position.quantity).greaterThan(0)) continue;
      const held = heldAtPayment(depot.rows, row, actions, today);
      const scale = (amount: Decimal) => (held.isZero() ? amount : amount.times(position.quantity).dividedBy(held));
      expected.push({
        depotId: depot.depotId,
        securityId: current,
        date: addMonths(row.date, 12),
        basedOn: row.date,
        gross: canonicalDecimal(scale(amounts.gross)),
        net: canonicalDecimal(scale(amounts.net)),
      });
    }
    for (const securityId of payingIds) {
      const position = positions.get(securityId);
      if (!position) continue;
      paying += 1;
      if (position.value === null) unpriced = true;
      else payingValue = payingValue.plus(position.value);
    }
  }

  const years = new Map<string, Amounts>();
  for (const [key, amounts] of months) {
    const year = key.slice(0, 4);
    years.set(year, add(years.get(year) ?? zero(), amounts));
  }
  let running = zero();
  const cumulative = [...years].map(([year, amounts]) => bucket(year, (running = add(running, amounts))));

  const bySecurity: DividendSecurity[] = [...securities]
    .map(([securityId, entry]) => {
      const costBasis = costBases.get(securityId) ?? null;
      const yieldOnCost = (income: Decimal) =>
        costBasis === null || costBasis.isZero() ? null : ratioString(new ReturnDecimal(income.toFixed()).dividedBy(costBasis.toFixed()));
      return {
        securityId,
        count: entry.count,
        gross: canonicalDecimal(entry.amounts.gross),
        net: canonicalDecimal(entry.amounts.net),
        lastDate: entry.lastDate,
        trailingGross: canonicalDecimal(entry.trailing.gross),
        trailingNet: canonicalDecimal(entry.trailing.net),
        costBasis: costBasis === null ? null : canonicalDecimal(costBasis),
        grossYieldOnCost: yieldOnCost(entry.trailing.gross),
        netYieldOnCost: yieldOnCost(entry.trailing.net),
      };
    })
    .sort((a, b) => new ExactDecimal(b.gross).comparedTo(a.gross) || (a.securityId < b.securityId ? -1 : a.securityId > b.securityId ? 1 : 0));

  const yieldOf = (income: Decimal) =>
    paying === 0 || unpriced || payingValue.isZero() ? null : canonicalDecimal(income.dividedBy(payingValue));

  expected.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.depotId !== b.depotId ? (a.depotId < b.depotId ? -1 : 1) : a.securityId < b.securityId ? -1 : a.securityId > b.securityId ? 1 : 0,
  );
  const expectedTotals = new Map<string, Amounts>(monthRange(today.slice(0, 7), addMonths(today, 12).slice(0, 7)).map((key) => [key, zero()]));
  for (const payment of expected) {
    const key = payment.date.slice(0, 7);
    expectedTotals.set(key, add(expectedTotals.get(key) ?? zero(), { gross: new ExactDecimal(payment.gross), net: new ExactDecimal(payment.net) }));
  }

  const order = bySecurity.map((security) => security.securityId);
  const monthsBySecurity: DividendMonthSplit[] = [...months.keys()].map((period) => {
    const paid = split.get(period);
    return {
      period,
      securities: paid
        ? order.filter((id) => paid.has(id)).map((securityId) => ({ securityId, ...bucketAmounts(paid.get(securityId) as Amounts) }))
        : [],
    };
  });

  const todayMonth = Number(today.slice(5, 7));
  const todayYear = today.slice(0, 4);
  let yearToDate = zero();
  const yearLines: DividendYearLine[] = [...years.keys()].map((year) => {
    let total = zero();
    const points = Array.from({ length: 12 }, (_, i): DividendYearPoint => {
      if (year === todayYear && i + 1 > todayMonth) return null;
      total = add(total, months.get(monthKey(Number(year), i + 1)) ?? zero());
      return bucketAmounts(total);
    });
    if (year === todayYear) yearToDate = total;
    return { year, points };
  });

  return {
    months: [...months].map(([key, amounts]) => bucket(key, amounts)),
    years: [...years].map(([key, amounts]) => bucket(key, amounts)),
    cumulative,
    bySecurity,
    trailing: {
      from,
      to,
      gross: canonicalDecimal(trailing.gross),
      net: canonicalDecimal(trailing.net),
      payingValue: canonicalDecimal(payingValue),
      grossYield: yieldOf(trailing.gross),
      netYield: yieldOf(trailing.net),
    },
    expected,
    expectedMonths: [...expectedTotals].map(([key, amounts]) => bucket(key, amounts)),
    monthsBySecurity,
    yearLines,
    forecast: forecastOf(today, yearToDate, expected),
  };
}
