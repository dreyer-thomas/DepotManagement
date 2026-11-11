/**
 * Presentation-edge helpers of the price chart ("Kurs" mode of the Security page, story 4-7): plot
 * coordinates (`Number(...)` only here), tooltip lines and the text alternative — every displayed text
 * formatted from the original decimal strings via `core/format`.
 */
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { PriceMarkLines } from "@/core/price-marks";
import type { FibonacciLevel, ZigzagPivot, ZigzagThreshold } from "@/core/zigzag";
import { spanDays, tickLabel, utcDate } from "./value-chart";

/** One day of the price line; `price` is a decimal string or `null` before the first known price. */
export type PriceChartPoint = { date: string; price: string | null };

/** One trade marker; quantity and price per unit already in the chart's units (decimal strings). */
export type PriceChartTrade = {
  depotName: string;
  type: "BUY" | "SELL";
  date: string;
  quantity: string;
  price: string;
  /** True when a corporate action changed quantity or price. */
  adjusted: boolean;
};

/** Plot coordinates, index-aligned with the points; markers sit on the day's price. */
export type PricePlotData = {
  dates: Date[];
  prices: (number | null)[];
  buys: (number | null)[];
  sells: (number | null)[];
};

/** One day of the moving-average overlay (story 7-8): decimal string or `null` while too few closes. */
export type PriceChartAverage = { date: string; average: string | null };

/** The overlay's window in stored closes. */
export type PriceChartAverageWindow = "200" | "38";

/** The optional dashed moving-average overlay of the price chart. */
export type PriceChartAverageOverlay = { window: PriceChartAverageWindow; points: readonly PriceChartAverage[] };

/**
 * The optional pivots overlay (story 11.5): ZigZag pivots of the selected threshold and the Fibonacci
 * levels of the last completed swing (`core/zigzag`), in the chart's units. No wave count, ever.
 */
export type PriceChartPivotOverlay = {
  threshold: ZigzagThreshold;
  pivots: readonly ZigzagPivot[];
  retracements: readonly FibonacciLevel[];
  extension: FibonacciLevel | null;
};

/**
 * The optional price-marks overlay (story 12.3, `core/price-marks` `priceMarkLines`): a fixed stop and the
 * target as levels, a trailing stop as a line per chart day, in the chart's units.
 */
export type PriceChartMarks = PriceMarkLines;

export const STOP_LINE_LABEL = "Stopp";
export const TARGET_LINE_LABEL = "Ziel";

export const TRADE_LABELS = { BUY: "Kauf", SELL: "Verkauf" } as const;
export const NO_PRICE_HISTORY_TEXT = "Kein Kursverlauf vorhanden.";

/** Caption when the overlay is on but no day has an average: `Zu wenig gespeicherte Kurse für GD 200.` */
export function noAverageText(window: PriceChartAverageWindow): string {
  return `Zu wenig gespeicherte Kurse für ${averageLabel(window)}.`;
}

/** True when at least one day of the overlay has an average. */
export function hasAverage(overlay: PriceChartAverageOverlay | undefined): boolean {
  return overlay !== undefined && overlay.points.some((point) => point.average !== null);
}

/** True when at least one day has a price. */
export function hasPriceHistory(points: readonly PriceChartPoint[]): boolean {
  return points.some((point) => point.price !== null);
}

/** The trades of `date`, in the given order. */
export function tradesOn(trades: readonly PriceChartTrade[], date: string): PriceChartTrade[] {
  return trades.filter((trade) => trade.date === date);
}

/**
 * Plot coordinates: the price line (gaps as `null`) and one buy and one sell marker per day that has
 * such trades, at the day's price — or the first such trade's price when the day has none.
 */
export function toPricePlotData(points: readonly PriceChartPoint[], trades: readonly PriceChartTrade[]): PricePlotData {
  const prices = points.map((point) => (point.price === null ? null : Number(point.price)));
  const marker = (type: PriceChartTrade["type"]) =>
    points.map((point, index) => {
      const first = trades.find((trade) => trade.date === point.date && trade.type === type);
      if (!first) return null;
      return prices[index] ?? Number(first.price);
    });
  return { dates: points.map((point) => utcDate(point.date)), prices, buys: marker("BUY"), sells: marker("SELL") };
}

/** Plot coordinates of the overlay, index-aligned with the price points by date (`null` = gap). */
export function toAveragePlotData(points: readonly PriceChartPoint[], averages: readonly PriceChartAverage[]): (number | null)[] {
  const byDate = new Map(averages.map((point) => [point.date, point.average]));
  return points.map((point) => {
    const average = byDate.get(point.date);
    return average == null ? null : Number(average);
  });
}

/** Threshold label: `8 %`. */
export function pivotThresholdLabel(threshold: ZigzagThreshold): string {
  return `${threshold}\u00a0%`;
}

const LEVEL_RATIO_LABELS: Record<FibonacciLevel["ratio"], string> = {
  "0.382": "38,2\u00a0%",
  "0.5": "50\u00a0%",
  "0.618": "61,8\u00a0%",
  "1.618": "161,8\u00a0%",
};

/** The drawn levels: retracements, then the extension when there is one. */
export function pivotLevels(overlay: PriceChartPivotOverlay): FibonacciLevel[] {
  return overlay.extension ? [...overlay.retracements, overlay.extension] : [...overlay.retracements];
}

/** Label of a level line: `38,2 % · 107,64 €`. */
export function pivotLevelLabel(level: FibonacciLevel): string {
  return `${LEVEL_RATIO_LABELS[level.ratio]} · ${formatMoney(level.price)}`;
}

/**
 * Caption below the chart when the overlay draws no levels: `Keine Wendepunkte ab 8 % im Zeitraum.`
 * without pivots, `Keine abgeschlossene Bewegung ab 8 % im Zeitraum.` with a single one; `null` otherwise.
 */
export function pivotCaption(overlay: PriceChartPivotOverlay): string | null {
  const threshold = pivotThresholdLabel(overlay.threshold);
  if (overlay.pivots.length === 0) return `Keine Wendepunkte ab ${threshold} im Zeitraum.`;
  if (overlay.pivots.length === 1) return `Keine abgeschlossene Bewegung ab ${threshold} im Zeitraum.`;
  return null;
}

/** Plot coordinates of the ZigZag line, index-aligned with the price points: the pivot price on pivot dates, else `null`. */
export function toPivotPlotData(points: readonly PriceChartPoint[], pivots: readonly ZigzagPivot[]): (number | null)[] {
  const byDate = new Map(pivots.map((pivot) => [pivot.date, pivot.price]));
  return points.map((point) => {
    const price = byDate.get(point.date);
    return price === undefined ? null : Number(price);
  });
}

/**
 * The y-axis range covering the plotted values and every drawn level (5 % padding of the span), or
 * `null` without levels (the axis keeps its automatic range).
 */
export function pivotYRange(
  values: readonly (number | null)[],
  overlay: PriceChartPivotOverlay | undefined,
): { min: number; max: number } | null {
  return levelsYRange(values, overlay ? pivotLevels(overlay).map((level) => Number(level.price)) : []);
}

/** The horizontal levels of the marks overlay: fixed stop and target (trailing stops are a series). */
export function markLevels(marks: PriceChartMarks | undefined): { label: string; kind: "stop" | "target"; price: string }[] {
  if (!marks) return [];
  return [
    ...(marks.stop?.kind === "fixed" ? [{ label: STOP_LINE_LABEL, kind: "stop" as const, price: marks.stop.value }] : []),
    ...(marks.target !== null ? [{ label: TARGET_LINE_LABEL, kind: "target" as const, price: marks.target }] : []),
  ];
}

/** Plot coordinates of a trailing stop, index-aligned with the price points by date (`null` = gap); `null` without one. */
export function toTrailingStopPlotData(points: readonly PriceChartPoint[], marks: PriceChartMarks | undefined): (number | null)[] | null {
  if (marks?.stop?.kind !== "trailing") return null;
  const byDate = new Map(marks.stop.points.map((point) => [point.date, point.value]));
  const values = points.map((point) => {
    const value = byDate.get(point.date);
    return value == null ? null : Number(value);
  });
  return values.some((value) => value !== null) ? values : null;
}

/** The trailing stop's tooltip line of a day (`Stopp` · money), `null` without a trailing value that day. */
export function stopTooltipLine(date: string, marks: PriceChartMarks | undefined): { label: string; value: string } | null {
  if (marks?.stop?.kind !== "trailing") return null;
  const value = marks.stop.points.find((point) => point.date === date)?.value ?? null;
  return value === null ? null : { label: STOP_LINE_LABEL, value: formatMoney(value) };
}

/**
 * Text-alternative suffix of the marks: `, mit Kursmarken: Stopp 92,40 €, Ziel 245,00 €` (trailing:
 * `Stopp nachlaufend zuletzt 93,50 €`); empty without a drawn mark.
 */
export function marksAriaSuffix(marks: PriceChartMarks | undefined): string {
  if (!marks) return "";
  const parts: string[] = [];
  if (marks.stop?.kind === "fixed") parts.push(`${STOP_LINE_LABEL} ${formatMoney(marks.stop.value)}`);
  if (marks.stop?.kind === "trailing") {
    const last = marks.stop.points.filter((point) => point.value !== null).at(-1)?.value;
    if (last != null) parts.push(`${STOP_LINE_LABEL} nachlaufend zuletzt ${formatMoney(last)}`);
  }
  if (marks.target !== null) parts.push(`${TARGET_LINE_LABEL} ${formatMoney(marks.target)}`);
  return parts.length === 0 ? "" : `, mit Kursmarken: ${parts.join(", ")}`;
}

/**
 * The y-axis range covering the plotted values and the given levels (5 % padding of the span), or `null`
 * without levels (the axis keeps its automatic range).
 */
export function levelsYRange(values: readonly (number | null)[], levels: readonly number[]): { min: number; max: number } | null {
  if (levels.length === 0) return null;
  const all = [...values.filter((value): value is number => value !== null), ...levels];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.05 || Math.abs(max) * 0.05 || 1;
  return { min: min - pad, max: max + pad };
}

/** The pivot's tooltip line of a day (`Wendepunkt` · `Hoch` / `Tief`), `null` on other days. */
export function pivotTooltipLine(date: string, overlay: PriceChartPivotOverlay): { label: string; value: string } | null {
  const pivot = overlay.pivots.find((candidate) => candidate.date === date);
  return pivot ? { label: "Wendepunkt", value: pivot.kind === "high" ? "Hoch" : "Tief" } : null;
}

/**
 * Text-alternative suffix of the overlay: `, mit Wendepunkten ab 8 %: 3 Wendepunkte, Fibonacci 38,2 % 107,64 €, …`
 * (without levels only the pivot count).
 */
export function pivotAriaSuffix(overlay: PriceChartPivotOverlay): string {
  const base = `, mit Wendepunkten ab ${pivotThresholdLabel(overlay.threshold)}: ${count(overlay.pivots.length, "Wendepunkt", "Wendepunkte")}`;
  const levels = pivotLevels(overlay);
  if (levels.length === 0) return base;
  return `${base}, Fibonacci ${levels.map((level) => `${LEVEL_RATIO_LABELS[level.ratio]} ${formatMoney(level.price)}`).join(", ")}`;
}

/** Tooltip label of the overlay: `GD 200`, `GD 38`. */
export function averageLabel(window: PriceChartAverageWindow): string {
  return `GD ${window}`;
}

/** The overlay's tooltip line of a day: label and the average as money, `–` without one. */
export function averageTooltipLine(
  date: string,
  overlay: PriceChartAverageOverlay,
): { label: string; value: string } {
  const average = overlay.points.find((point) => point.date === date)?.average ?? null;
  return { label: averageLabel(overlay.window), value: average === null ? "–" : formatMoney(average) };
}

/** `Kauf · Depot A · 20 Stück à 50,00 € (split-bereinigt)`. */
export function tradeLine(trade: PriceChartTrade): string {
  const base = `${TRADE_LABELS[trade.type]} · ${trade.depotName} · ${formatQuantity(trade.quantity)} Stück à ${formatMoney(trade.price)}`;
  return trade.adjusted ? `${base} (split-bereinigt)` : base;
}

/** Tooltip texts of one day: date, `Kurs` (or `–`), one line per trade of that day. */
export function priceTooltipLines(
  point: PriceChartPoint,
  trades: readonly PriceChartTrade[],
): { date: string; price: string; trades: string[] } {
  return {
    date: formatDate(point.date),
    price: point.price === null ? "–" : formatMoney(point.price),
    trades: tradesOn(trades, point.date).map(tradeLine),
  };
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Text alternative, e.g. `Kursverlauf 01.01.2026 – 26.10.2026: Kurs von 100,00 € auf 112,46 €, 2 Käufe,
 * 1 Verkauf` — first and last known price of the range; with the overlay `…, mit gleitendem Durchschnitt
 * 200 Tage` appended; with the pivots overlay `pivotAriaSuffix` after that; with marks `marksAriaSuffix` last.
 */
export function priceChartAriaLabel(
  points: readonly PriceChartPoint[],
  trades: readonly PriceChartTrade[],
  averageWindow?: PriceChartAverageWindow,
  pivots?: PriceChartPivotOverlay,
  marks?: PriceChartMarks,
): string {
  const first = points.at(0);
  const last = points.at(-1);
  const priced = points.filter((point) => point.price !== null);
  const from = priced.at(0)?.price;
  const to = priced.at(-1)?.price;
  if (!first || !last || from == null || to == null) return "Kursverlauf: keine Daten";
  const buys = trades.filter((trade) => trade.type === "BUY").length;
  const sells = trades.length - buys;
  return (
    `Kursverlauf ${formatDate(first.date)} – ${formatDate(last.date)}: Kurs von ${formatMoney(from)} auf ${formatMoney(to)}, ` +
    `${count(buys, "Kauf", "Käufe")}, ${count(sells, "Verkauf", "Verkäufe")}` +
    (averageWindow ? `, mit gleitendem Durchschnitt ${averageWindow} Tage` : "") +
    (pivots ? pivotAriaSuffix(pivots) : "") +
    marksAriaSuffix(marks)
  );
}

/**
 * The x-axis value formatter handed to x-charts: ticks get the compact label, tooltip and screen-reader
 * descriptions the full date.
 */
export function priceXFormatter(points: readonly PriceChartPoint[]) {
  const span = spanDays(points.map((point) => utcDate(point.date)));
  const indexByTime = new Map(points.map((point, index) => [utcDate(point.date).getTime(), index]));
  return (date: Date, context?: { location?: string }): string => {
    if (context?.location === "tick") return tickLabel(date, span);
    const index = indexByTime.get(date.getTime());
    return index === undefined ? "" : formatDate(points[index].date);
  };
}
