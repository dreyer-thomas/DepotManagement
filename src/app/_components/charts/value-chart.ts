/**
 * Presentation-edge helpers of the value chart (AD-5): the one place where series points become plot
 * coordinates (`Number(...)`) and where every displayed chart text is formatted — always from the
 * original decimal strings via `core/format`, so tooltip and KPI read byte-identical.
 */
import { formatDate, formatMoney } from "@/core/format";
import type { ValuationPoint } from "@/core/valuation";

/** One chart point as it crosses into the client component; amounts are decimal strings. */
export type ChartPoint = {
  /** Business date `YYYY-MM-DD`. */
  date: string;
  value: string;
  invested: string;
};

/** The plot coordinates of the chart points, index-aligned with them. */
export type PlotData = {
  dates: Date[];
  values: number[];
  invested: number[];
};

/** Display strings of one point for the tooltip. */
export type TooltipLines = {
  date: string;
  value: string;
  invested: string;
};

/** Valuation series → chart points (renames only; values stay the series' decimal strings). */
export function toChartPoints(series: readonly Pick<ValuationPoint, "date" | "value" | "investedCapital">[]): ChartPoint[] {
  return series.map((point) => ({ date: point.date, value: point.value, invested: point.investedCapital }));
}

/** Business date → UTC midnight, so plotting and tick labels do not depend on the runtime time zone. */
export function utcDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Plot coordinates; the only conversion of amounts to JS numbers. */
export function toPlotData(points: readonly ChartPoint[]): PlotData {
  return {
    dates: points.map((point) => utcDate(point.date)),
    values: points.map((point) => Number(point.value)),
    invested: points.map((point) => Number(point.invested)),
  };
}

/** Tooltip texts of one point: `25.10.2026`, `12.345,68 €`, `9.500,00 €`. */
export function tooltipLines(point: ChartPoint): TooltipLines {
  return { date: formatDate(point.date), value: formatMoney(point.value), invested: formatMoney(point.invested) };
}

/**
 * Text alternative naming the Period and the first/last value and invested capital, e.g.
 * `Wertentwicklung 01.01.2026 – 26.10.2026: Wert von 10.000,00 € auf 12.345,67 €, investiertes Kapital
 * von 9.000,00 € auf 9.500,00 €`.
 */
export function chartAriaLabel(points: readonly ChartPoint[]): string {
  const first = points.at(0);
  const last = points.at(-1);
  if (!first || !last) return "Wertentwicklung: keine Daten";
  const a = tooltipLines(first);
  const b = tooltipLines(last);
  return (
    `Wertentwicklung ${a.date} – ${b.date}: Wert von ${a.value} auf ${b.value}, ` +
    `investiertes Kapital von ${a.invested} auf ${b.invested}`
  );
}

const DAY_MS = 86_400_000;

/**
 * Compact de-DE x-axis tick label of a UTC-midnight date: month starts of a Period longer than two
 * months read `01.2026`, every other tick `25.10.`.
 */
export function tickLabel(tick: Date, spanDays: number): string {
  const day = String(tick.getUTCDate()).padStart(2, "0");
  const month = String(tick.getUTCMonth() + 1).padStart(2, "0");
  if (spanDays > 62 && tick.getUTCDate() === 1) return `${month}.${tick.getUTCFullYear()}`;
  return `${day}.${month}.`;
}

/** Days between the first and last plotted date. */
export function spanDays(dates: readonly Date[]): number {
  const first = dates.at(0);
  const last = dates.at(-1);
  return first && last ? Math.round((last.getTime() - first.getTime()) / DAY_MS) : 0;
}

/** At most `max` entries picked evenly (every n-th), starting with the first. */
function thin<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = Math.ceil(items.length / max);
  return items.filter((_, index) => index % step === 0);
}

const MAX_TICKS = 6;

/**
 * Explicit x-axis tick dates (all UTC midnight): for Periods up to two months the plotted dates
 * themselves, for longer Periods only the month starts within the range — each thinned evenly to at
 * most six, so labels never repeat and one axis never mixes `01.2026` with `15.01.`.
 */
export function tickDates(dates: readonly Date[]): Date[] {
  const first = dates.at(0);
  const last = dates.at(-1);
  if (!first || !last) return [];
  if (spanDays(dates) <= 62) return thin(dates, MAX_TICKS);
  const monthStarts: Date[] = [];
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth() + (first.getUTCDate() === 1 ? 0 : 1);
  for (;;) {
    const start = new Date(Date.UTC(year, month, 1));
    if (start.getTime() > last.getTime()) break;
    monthStarts.push(start);
    year = start.getUTCFullYear();
    month = start.getUTCMonth() + 1;
  }
  return thin(monthStarts, MAX_TICKS);
}

/** Context x-charts passes to an axis value formatter (only the location matters here). */
type FormatterContext = { location?: string };

/**
 * The value formatters handed to x-charts. Ticks get the compact label; tooltip and screen-reader
 * descriptions get the full date and `formatMoney` text from the original decimal strings by data index.
 */
export function chartFormatters(points: readonly ChartPoint[]) {
  const span = spanDays(points.map((point) => utcDate(point.date)));
  const indexByTime = new Map(points.map((point, index) => [utcDate(point.date).getTime(), index]));
  return {
    x: (date: Date, context?: FormatterContext): string => {
      if (context?.location === "tick") return tickLabel(date, span);
      const index = indexByTime.get(date.getTime());
      return index === undefined ? "" : formatDate(points[index].date);
    },
    value: (_: number | null, { dataIndex }: { dataIndex: number }): string => {
      const point = points.at(dataIndex);
      return point ? formatMoney(point.value) : "";
    },
    invested: (_: number | null, { dataIndex }: { dataIndex: number }): string => {
      const point = points.at(dataIndex);
      return point ? formatMoney(point.invested) : "";
    },
  };
}
