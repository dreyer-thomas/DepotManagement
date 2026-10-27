/**
 * Presentation-edge helpers of the drawdown chart (story 7-6): plot coordinates (`Number(...)` only
 * here), tooltip lines, the text alternative and the KPI texts — every displayed text formatted from the
 * original decimal strings via `core/format`.
 */
import { formatDate, formatMoney, formatPercent } from "@/core/format";
import type { DrawdownPhase } from "@/core/drawdown";
import { type PriceChartTrade, tradeLine, tradesOn } from "./price-chart";
import { spanDays, tickLabel, utcDate } from "./value-chart";

/** One day of the drawdown line: ratio string (≤ 0) or `null` without a level. */
export type DrawdownChartPoint = { date: string; drawdown: string | null };

/** One dividend marker: gross amount (decimal string) of a booking Depot. */
export type DrawdownChartDividend = { depotName: string; date: string; amount: string };

/** The drawdown KPIs as `core/drawdown` returns them. */
export type DrawdownSummary = { current: string | null; max: string | null; phase: DrawdownPhase | null };

/** Plot coordinates, index-aligned with the points; markers sit on the day's drawdown. */
export type DrawdownPlotData = {
  dates: Date[];
  values: (number | null)[];
  buys: (number | null)[];
  sells: (number | null)[];
  dividends: (number | null)[];
};

export const MISSING = "–";
export const NO_DRAWDOWN_TEXT = "Kein Drawdown-Verlauf vorhanden.";
export const DRAWDOWN_KPI_LABELS = {
  current: "Aktueller Drawdown",
  max: "Maximaler Drawdown",
  duration: "Dauer",
  period: "Periode",
} as const;

/** True when at least one day has a drawdown. */
export function hasDrawdown(points: readonly DrawdownChartPoint[]): boolean {
  return points.some((point) => point.drawdown !== null);
}

/** The dividends of `date`, in the given order. */
export function dividendsOn(dividends: readonly DrawdownChartDividend[], date: string): DrawdownChartDividend[] {
  return dividends.filter((dividend) => dividend.date === date);
}

/**
 * Plot coordinates: the drawdown line (gaps as `null`) and one buy, sell and dividend marker per day that
 * has such an event, at the day's drawdown (none on a day without one).
 */
export function toDrawdownPlotData(
  points: readonly DrawdownChartPoint[],
  trades: readonly PriceChartTrade[] = [],
  dividends: readonly DrawdownChartDividend[] = [],
): DrawdownPlotData {
  const values = points.map((point) => (point.drawdown === null ? null : Number(point.drawdown)));
  const marker = (has: (date: string) => boolean) => points.map((point, index) => (has(point.date) ? values[index] : null));
  return {
    dates: points.map((point) => utcDate(point.date)),
    values,
    buys: marker((date) => trades.some((trade) => trade.date === date && trade.type === "BUY")),
    sells: marker((date) => trades.some((trade) => trade.date === date && trade.type === "SELL")),
    dividends: marker((date) => dividends.some((dividend) => dividend.date === date)),
  };
}

/** `Dividende · Depot A · 12,00 €` (gross). */
export function dividendLine(dividend: DrawdownChartDividend): string {
  return `Dividende · ${dividend.depotName} · ${formatMoney(dividend.amount)}`;
}

/** Tooltip texts of one day: date, drawdown (or `–`), one line per trade and dividend of that day. */
export function drawdownTooltipLines(
  point: DrawdownChartPoint,
  trades: readonly PriceChartTrade[] = [],
  dividends: readonly DrawdownChartDividend[] = [],
): { date: string; drawdown: string; events: string[] } {
  return {
    date: formatDate(point.date),
    drawdown: point.drawdown === null ? MISSING : formatPercent(point.drawdown),
    events: [...tradesOn(trades, point.date).map(tradeLine), ...dividendsOn(dividends, point.date).map(dividendLine)],
  };
}

/** Signed percent or `–`. */
function percentOrMissing(ratio: string | null): string {
  return ratio === null ? MISSING : formatPercent(ratio);
}

/**
 * Text alternative naming the Period and the maximum drawdown, e.g. `Drawdown 01.02.2026 – 06.02.2026:
 * maximaler Drawdown -19,00 %`.
 */
export function drawdownAriaLabel(points: readonly DrawdownChartPoint[], max: string | null): string {
  const first = points.at(0);
  const last = points.at(-1);
  if (!first || !last) return "Drawdown: keine Daten";
  return `Drawdown ${formatDate(first.date)} – ${formatDate(last.date)}: maximaler Drawdown ${percentOrMissing(max)}`;
}

/** `1 Tag`, `4 Tage`. */
function daysText(days: number): string {
  return `${days} ${days === 1 ? "Tag" : "Tage"}`;
}

/**
 * The four KPI texts: current and maximum drawdown (signed percent), the phase's duration (with the note
 * `nicht erholt` while unrecovered) and its dates; `–` for a `null` value or phase.
 */
export function drawdownKpiTexts(summary: DrawdownSummary): {
  current: string;
  max: string;
  duration: string;
  durationNote?: string;
  period: string;
} {
  const { phase } = summary;
  return {
    current: percentOrMissing(summary.current),
    max: percentOrMissing(summary.max),
    duration: phase === null ? MISSING : daysText(phase.days),
    ...(phase !== null && !phase.recovered ? { durationNote: "nicht erholt" } : {}),
    period: phase === null ? MISSING : `${formatDate(phase.peak)} – ${formatDate(phase.end)}`,
  };
}

/**
 * The value formatters handed to x-charts: x ticks get the compact date label, tooltip and screen-reader
 * descriptions the full date; y ticks a percent (the plotted ratio); series values the day's drawdown
 * from its decimal string by data index.
 */
export function drawdownFormatters(points: readonly DrawdownChartPoint[]) {
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
      return point ? percentOrMissing(point.drawdown) : "";
    },
  };
}

/**
 * Lower y-axis bound: the plotted minimum with a 5 % margin below it (so the trough and its markers are
 * not clipped), or a small negative range when there is no decline.
 */
export function drawdownYMin(values: readonly (number | null)[]): number {
  const min = values.reduce<number>((lowest, value) => (value !== null && value < lowest ? value : lowest), 0);
  return min < 0 ? min * 1.05 : -0.01;
}
