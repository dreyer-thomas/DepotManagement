/**
 * Benchmark comparison (story 8-2): the reference table of index ETFs and the pure line builders of the
 * "Performance" chart tab. A scope line is the cumulative TTWROR (`ttwrorIndex` − 1, AD-10); a benchmark
 * line is the ETF's price return against its resolver price on the line's start date. Every line starts
 * with `"0"` on the valuation start point (`start.date`, the day before the Period's `from`). Ratios are
 * decimal strings (`ratioString`).
 */
import { addDays, addMonths } from "./dates";
import { ratioString, ReturnDecimal, ttwrorIndex, type FlowRow } from "./returns";
import type { PerformancePoint, PricePoint } from "./security";
import type { ValuationPoint } from "./valuation";

export type { PerformancePoint } from "./security";

export const BENCHMARK_KEYS = ["msci-world", "msci-acwi", "dax", "sp500"] as const;
export type BenchmarkKey = (typeof BENCHMARK_KEYS)[number];

/** A benchmark: an accumulating EUR UCITS ETF tracking the index, priced like any Security but never held. */
export type Benchmark = { key: BenchmarkKey; label: string; isin: string; name: string };

/** The benchmark ETFs (asset type ETF), in the order of the "Vergleich mit" select. */
export const BENCHMARKS: readonly Benchmark[] = [
  { key: "msci-world", label: "MSCI World", isin: "IE00B4L5Y983", name: "iShares Core MSCI World UCITS ETF (Acc)" },
  { key: "msci-acwi", label: "MSCI ACWI", isin: "IE00B6R52259", name: "iShares MSCI ACWI UCITS ETF (Acc)" },
  { key: "dax", label: "DAX", isin: "DE0005933931", name: "iShares Core DAX UCITS ETF (DE)" },
  { key: "sp500", label: "S&P 500", isin: "IE00B5BMR087", name: "iShares Core S&P 500 UCITS ETF (Acc)" },
];

/** Days of benchmark history fetched before the earliest needed date (a base close before any Period start). */
export const BENCHMARK_HISTORY_DAYS = 10;

/** Months back of the longest preset Period other than `MAX` (`3J`, `resolvePeriod`). */
const LONGEST_PRESET_MONTHS = 36;

/**
 * The first date of benchmark price history: `BENCHMARK_HISTORY_DAYS` before the earlier of the earliest
 * ledger date and the `3J` preset start (`today` − 36 months), so every preset Period has a base close
 * even on a ledger younger than the Period.
 */
export function benchmarkStartDate(firstLedgerDate: string, today: string): string {
  const presetStart = addMonths(today, -LONGEST_PRESET_MONTHS);
  const earliest = firstLedgerDate < presetStart ? firstLedgerDate : presetStart;
  return addDays(earliest, -BENCHMARK_HISTORY_DAYS);
}

/**
 * A performance line from a TTWROR index (`ttwrorIndex` levels, base `1` on `startDate`): `"0"` on
 * `startDate`, then per level `level − 1`.
 */
export function indexPerformanceLine(startDate: string, index: readonly { date: string; level: string }[]): PerformancePoint[] {
  return [
    { date: startDate, performance: "0" },
    ...index.map(({ date, level }) => ({ date, performance: ratioString(new ReturnDecimal(level).minus(1)) })),
  ];
}

/**
 * The cumulative TTWROR line of a scope (Depot or Portfolio) over `series`, `start` the valuation point of
 * the day before: `"0"` on `start.date`, then the chain after each day − 1 (same flow rules as `ttwror`).
 * The last point equals the Period TTWROR whenever that is non-null.
 */
export function performanceLine(
  start: ValuationPoint,
  series: readonly ValuationPoint[],
  rows: readonly FlowRow[],
): PerformancePoint[] {
  return indexPerformanceLine(start.date, ttwrorIndex(start, series, rows));
}

/**
 * The price-return line of a daily price series (`securityPriceSeries`, first point = the line's start
 * date): per day `price / base − 1` with the first point's price as base. `null` when the base is missing
 * or zero (no close on or before the start date), so no comparison can be drawn.
 */
export function priceReturnLine(prices: readonly PricePoint[]): PerformancePoint[] | null {
  const base = prices.at(0)?.price;
  if (base === null || base === undefined || new ReturnDecimal(base).isZero()) return null;
  const divisor = new ReturnDecimal(base);
  let last = base;
  return prices.map(({ date, price }) => {
    // The series is carried forward, so a later null cannot occur; keep the last price defensively.
    if (price !== null) last = price;
    return { date, performance: ratioString(new ReturnDecimal(last).dividedBy(divisor).minus(1)) };
  });
}

/** Scope return minus comparison return (a ratio, shown in percentage points); `null` when either is missing. */
export function returnDifference(scope: string | null | undefined, comparison: string | null | undefined): string | null {
  if (scope === null || scope === undefined || comparison === null || comparison === undefined) return null;
  return ratioString(new ReturnDecimal(scope).minus(comparison));
}
