/**
 * Presentation-edge helpers of the price chart ("Kurs" mode of the Security page, story 4-7): plot
 * coordinates (`Number(...)` only here), tooltip lines and the text alternative — every displayed text
 * formatted from the original decimal strings via `core/format`.
 */
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
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
 * 200 Tage` appended.
 */
export function priceChartAriaLabel(
  points: readonly PriceChartPoint[],
  trades: readonly PriceChartTrade[],
  averageWindow?: PriceChartAverageWindow,
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
    (averageWindow ? `, mit gleitendem Durchschnitt ${averageWindow} Tage` : "")
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
