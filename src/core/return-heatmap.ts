/**
 * Monthly return heatmap (FR-22): per calendar month the TTWROR of that month's slice of the one daily
 * valuation series, chained into quarter and year totals. Same flow and skip rules as the period figures
 * (`ttwror`), so a year total equals the TTWROR over that year's points. Pure; "today" is passed in.
 */
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { adjustmentValueOf, chainReturns, externalFlow, type FlowRow, ttwror } from "./returns";
import type { ValuationPoint } from "./valuation";

/** One month of the heatmap; amounts and the ratio are decimal strings. */
export type HeatmapMonth = {
  /** `YYYY-MM`. */
  month: string;
  /** First and last series date of the month (first ledger date / today for the edge months). */
  from: string;
  to: string;
  /** Value at the end of the day before `from`. */
  startValue: string;
  /** Value on `to`. */
  endValue: string;
  /** TTWROR of the month (not annualised); `null` when nothing was invested. */
  return: string | null;
  /** Σ external flows of rows dated in the month + Σ `adjustmentValue` of its points. */
  netExternalFlows: string;
  /** Number of ledger rows (all types) dated in the month. */
  transactions: number;
  /** True for the month containing today. */
  running: boolean;
};

export type HeatmapYear = {
  year: number;
  /** January..December; `null` before the first ledger month or after today's month. */
  months: (HeatmapMonth | null)[];
  /** Q1..Q4, chained from their months with a return; `null` when none. */
  quarters: (string | null)[];
  /** The year chained from its months with a return; `null` when none. */
  total: string | null;
};

const monthKey = (year: number, month: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

/**
 * The heatmap over `series` (one point per day from the first ledger date to `today`, `start` the
 * point of the day before) and the scope's ledger `rows`. Years from the first ledger date's year to
 * today's, newest first; rows dated after `today` are ignored. `[]` without rows.
 */
export function returnHeatmap(
  start: ValuationPoint,
  series: readonly ValuationPoint[],
  allRows: readonly FlowRow[],
  today: string,
): HeatmapYear[] {
  // Future-dated rows lie beyond the series (which ends today): not part of any month yet.
  const rows = allRows.filter((row) => row.date <= today);
  if (rows.length === 0) return [];
  const firstDate = rows.reduce((first, row) => (row.date < first ? row.date : first), rows[0].date);
  const firstMonth = firstDate.slice(0, 7);
  const todayMonth = today.slice(0, 7);
  if (firstMonth > todayMonth) return [];

  // Series points, rows and the point before each month, grouped by `YYYY-MM`.
  const pointsByMonth = new Map<string, { previous: ValuationPoint; points: ValuationPoint[] }>();
  let previous = start;
  for (const point of series) {
    const key = point.date.slice(0, 7);
    let entry = pointsByMonth.get(key);
    if (!entry) pointsByMonth.set(key, (entry = { previous, points: [] }));
    entry.points.push(point);
    previous = point;
  }
  const rowsByMonth = new Map<string, FlowRow[]>();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    const list = rowsByMonth.get(key);
    if (list) list.push(row);
    else rowsByMonth.set(key, [row]);
  }

  const monthOf = (key: string): HeatmapMonth | null => {
    if (key < firstMonth || key > todayMonth) return null;
    const entry = pointsByMonth.get(key);
    if (!entry || entry.points.length === 0) return null;
    const monthRows = rowsByMonth.get(key) ?? [];
    let flows = new ExactDecimal(0);
    for (const row of monthRows) flows = flows.plus(externalFlow(row));
    for (const point of entry.points) flows = flows.plus(adjustmentValueOf(point));
    const end = entry.points[entry.points.length - 1];
    return {
      month: key,
      from: entry.points[0].date,
      to: end.date,
      startValue: entry.previous.value,
      endValue: end.value,
      return: ttwror(entry.previous, entry.points, monthRows),
      netExternalFlows: canonicalDecimal(flows),
      transactions: monthRows.length,
      running: key === todayMonth,
    };
  };

  const years: HeatmapYear[] = [];
  for (let year = Number(today.slice(0, 4)); year >= Number(firstDate.slice(0, 4)); year--) {
    const months = Array.from({ length: 12 }, (_, index) => monthOf(monthKey(year, index + 1)));
    const ratios = months.map((month) => month?.return ?? null);
    const quarters = [0, 1, 2, 3].map((quarter) => chainReturns(ratios.slice(quarter * 3, quarter * 3 + 3)));
    years.push({ year, months, quarters, total: chainReturns(ratios) });
  }
  return years;
}
