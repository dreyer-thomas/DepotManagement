/**
 * Presentation-edge helpers of the Security performance chart (story 7-8): plot coordinates
 * (`Number(...)` only here), tooltip lines and the text alternative — every displayed text formatted
 * from the original decimal strings via `core/format`.
 */
import { formatDate, formatPercent } from "@/core/format";
import { type DrawdownChartDividend, dividendLine, dividendsOn } from "./drawdown-chart";
import { type PriceChartTrade, tradeLine, tradesOn } from "./price-chart";
import { spanDays, tickLabel, utcDate } from "./value-chart";

/** One day of the performance line: cumulative TTWROR (ratio string, `0.1` = 10 %). */
export type PerformanceChartPoint = { date: string; performance: string };

/** Plot coordinates, index-aligned with the points; markers sit on the day's performance. */
export type PerformancePlotData = {
  dates: Date[];
  values: number[];
  buys: (number | null)[];
  sells: (number | null)[];
  dividends: (number | null)[];
};

export const PERFORMANCE_LABEL = "Performance";

/**
 * Plot coordinates: the performance line and one buy, sell and dividend marker per day that has such an
 * event, at the day's performance (none on a day without one).
 */
export function toPerformancePlotData(
  points: readonly PerformanceChartPoint[],
  trades: readonly PriceChartTrade[] = [],
  dividends: readonly DrawdownChartDividend[] = [],
): PerformancePlotData {
  const values = points.map((point) => Number(point.performance));
  const marker = (has: (date: string) => boolean) => points.map((point, index) => (has(point.date) ? values[index] : null));
  return {
    dates: points.map((point) => utcDate(point.date)),
    values,
    buys: marker((date) => trades.some((trade) => trade.date === date && trade.type === "BUY")),
    sells: marker((date) => trades.some((trade) => trade.date === date && trade.type === "SELL")),
    dividends: marker((date) => dividends.some((dividend) => dividend.date === date)),
  };
}

/** Tooltip texts of one day: date, signed performance, one line per trade and dividend of that day. */
export function performanceTooltipLines(
  point: PerformanceChartPoint,
  trades: readonly PriceChartTrade[] = [],
  dividends: readonly DrawdownChartDividend[] = [],
): { date: string; performance: string; events: string[] } {
  return {
    date: formatDate(point.date),
    performance: formatPercent(point.performance),
    events: [...tradesOn(trades, point.date).map(tradeLine), ...dividendsOn(dividends, point.date).map(dividendLine)],
  };
}

/** Text alternative, e.g. `Performance 01.02.2026 – 04.02.2026: +12,00 %` (the last point's performance). */
export function performanceAriaLabel(points: readonly PerformanceChartPoint[]): string {
  const first = points.at(0);
  const last = points.at(-1);
  if (!first || !last) return "Performance: keine Daten";
  return `Performance ${formatDate(first.date)} – ${formatDate(last.date)}: ${formatPercent(last.performance)}`;
}

/**
 * The value formatters handed to x-charts: x ticks get the compact date label, tooltip and screen-reader
 * descriptions the full date; y ticks a percent (the plotted ratio); series values the day's
 * performance from its decimal string by data index.
 */
export function performanceFormatters(points: readonly PerformanceChartPoint[]) {
  const span = spanDays(points.map((point) => utcDate(point.date)));
  const indexByTime = new Map(points.map((point, index) => [utcDate(point.date).getTime(), index]));
  return {
    x: (date: Date, context?: { location?: string }): string => {
      if (context?.location === "tick") return tickLabel(date, span);
      const index = indexByTime.get(date.getTime());
      return index === undefined ? "" : formatDate(points[index].date);
    },
    y: (ratio: number): string => formatPercent(String(ratio)),
    value: (_: number | null, { dataIndex }: { dataIndex: number }): string => {
      const point = points.at(dataIndex);
      return point ? formatPercent(point.performance) : "";
    },
  };
}

/** y-axis bounds that always include 0, so the 0 % reference line is drawn for one-sided series. */
export function performanceYDomain(values: readonly number[]): { min: number; max: number } {
  return { min: Math.min(0, ...values), max: Math.max(0, ...values) };
}
