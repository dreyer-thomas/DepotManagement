/**
 * Presentation edge of the card "Technische Lage" (story 11.3): row texts, tones, the source line and the
 * indicator chart's plot data, tooltip lines and text alternative. Computes no indicator (AD-23): every
 * value and interpretation key comes from `technicalPosition`; texts are formatted from its decimal
 * strings, `Number(...)` appears only in plot coordinates.
 */
import type { TechnicalIndicator } from "@/app/_components/charts/chart-preference";
import { spanDays, tickLabel, utcDate } from "@/app/_components/charts/value-chart";
import { formatDate, formatFigure, formatPercent, formatQuantity } from "@/core/format";
import { ReturnDecimal } from "@/core/returns";
import { TECHNICAL_PARAMETERS, type TechnicalPosition, type TechnicalSeriesPoint } from "@/core/technical";

/** The five signals of a technical position (without the series). */
export type TechnicalSignals = Omit<TechnicalPosition, "series">;

/** Secondary colour cue of an interpretation; the label text is always shown with it. */
export type TechnicalTone = "gain" | "loss" | "stale" | null;

/** One row "Signal · Wert · Einordnung"; `value` and `label` are `null` with too little history. */
export type TechnicalRow = { signal: string; value: string | null; label: string | null; tone: TechnicalTone };

export const INSUFFICIENT_TEXT = "zu wenig Kursdaten";
export const NO_SERIES_TEXT = "Kein Indikatorverlauf im Zeitraum.";
export const TECHNICAL_INDICATOR_LABELS: Record<TechnicalIndicator, string> = { tsi: "TSI", rsi: "RSI", macd: "MACD" };

const MISSING = "–";

/** Tone per interpretation key, by signal. */
const TONES = {
  trend: { up: "gain", down: "loss", sideways: null },
  rsi: { overbought: "stale", oversold: "stale", neutral: null },
  macd: { positive: "gain", "positive-turning-up": "gain", negative: "loss", "negative-turning-down": "loss" },
  tsi: { positive: "gain", negative: "loss", fading: "stale", turning: "stale" },
  fiftyTwoWeeks: { "near-high": "gain", "near-low": "loss", between: null },
} as const satisfies { [S in keyof TechnicalSignals]: Record<string, TechnicalTone> };

/** RSI and TSI: one decimal. */
function oneDecimal(value: string): string {
  return formatFigure(value, 1);
}

/** MACD values: four decimals when |value| < 1, otherwise two. */
export function macdDecimals(value: string): number {
  return new ReturnDecimal(value).abs().lessThan(1) ? 4 : 2;
}

function macdFigure(value: string, decimals = macdDecimals(value)): string {
  return formatFigure(value, decimals);
}

/** The five rows in the order Trend, RSI, MACD, TSI, 52 Wochen. */
export function technicalRows(signals: TechnicalSignals): TechnicalRow[] {
  const insufficient = (signal: string): TechnicalRow => ({ signal, value: null, label: null, tone: null });
  const { trend, rsi, macd, tsi, fiftyTwoWeeks } = signals;
  return [
    trend.value === null
      ? insufficient("Trend")
      : { signal: "Trend", value: `${formatPercent(trend.value, 1)} zum 200-Tage-Schnitt`, label: trend.label, tone: TONES.trend[trend.key] },
    rsi.value === null ? insufficient("RSI") : { signal: "RSI", value: oneDecimal(rsi.value), label: rsi.label, tone: TONES.rsi[rsi.key] },
    macd.value === null
      ? insufficient("MACD")
      : {
          signal: "MACD",
          value: `${macdFigure(macd.value)} (Signal ${macdFigure(macd.signal, macdDecimals(macd.value))})`,
          label: macd.label,
          tone: TONES.macd[macd.key],
        },
    tsi.value === null
      ? insufficient("TSI")
      : { signal: "TSI", value: `${oneDecimal(tsi.value)} (Signal ${oneDecimal(tsi.signal)})`, label: tsi.label, tone: TONES.tsi[tsi.key] },
    fiftyTwoWeeks.value === null
      ? insufficient("52 Wochen")
      : {
          signal: "52 Wochen",
          value: `${formatPercent(fiftyTwoWeeks.value, 1)} zum 52-Wochen-Hoch`,
          label: fiftyTwoWeeks.label,
          tone: TONES.fiftyTwoWeeks[fiftyTwoWeeks.key],
        },
  ];
}

/** `berechnet aus Schlusskursen, Stand 04.11.2026` (the last close date). */
export function technicalSourceLine(asOf: string): string {
  return `berechnet aus Schlusskursen, Stand ${formatDate(asOf)}`;
}

/** The main and signal values of a series point for an indicator (RSI has no signal line). */
function mainValue(point: TechnicalSeriesPoint, indicator: TechnicalIndicator): string | null {
  return indicator === "tsi" ? point.tsi : indicator === "rsi" ? point.rsi : point.macd;
}

function signalValue(point: TechnicalSeriesPoint, indicator: TechnicalIndicator): string | null {
  return indicator === "tsi" ? point.tsiSignal : indicator === "macd" ? point.macdSignal : null;
}

/** True when at least one point has a value of the indicator. */
export function hasIndicatorValues(series: readonly TechnicalSeriesPoint[], indicator: TechnicalIndicator): boolean {
  return series.some((point) => mainValue(point, indicator) !== null);
}

/** Plot coordinates of an indicator, index-aligned with the series points; histogram split by sign (MACD). */
export type TechnicalPlotData = {
  dates: Date[];
  main: (number | null)[];
  signal: (number | null)[];
  histogramPositive: (number | null)[];
  histogramNegative: (number | null)[];
};

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

/** Plot coordinates; the only conversion of indicator values to JS numbers. */
export function technicalPlotData(series: readonly TechnicalSeriesPoint[], indicator: TechnicalIndicator): TechnicalPlotData {
  const histogram = series.map((point) => (indicator === "macd" ? toNumber(point.macdHistogram) : null));
  return {
    dates: series.map((point) => utcDate(point.date)),
    main: series.map((point) => toNumber(mainValue(point, indicator))),
    signal: series.map((point) => toNumber(signalValue(point, indicator))),
    histogramPositive: histogram.map((value) => (value === null ? null : Math.max(value, 0))),
    histogramNegative: histogram.map((value) => (value === null ? null : Math.min(value, 0))),
  };
}

const DAY_MS = 86_400_000;

/** Every day `from..to` as UTC midnight: the price chart's x-axis domain, for its ticks and span. */
export function periodDates(from: string, to: string): Date[] {
  const start = utcDate(from).getTime();
  const end = utcDate(to).getTime();
  const dates: Date[] = [];
  for (let time = start; time <= end; time += DAY_MS) dates.push(new Date(time));
  return dates;
}

/** Tooltip texts of one point: the date and one labelled value per line of the indicator (`–` without). */
export function technicalTooltipLines(
  point: TechnicalSeriesPoint,
  indicator: TechnicalIndicator,
): { date: string; rows: { label: string; value: string }[] } {
  const date = formatDate(point.date);
  if (indicator === "rsi") return { date, rows: [{ label: "RSI", value: point.rsi === null ? MISSING : oneDecimal(point.rsi) }] };
  if (indicator === "tsi") {
    return {
      date,
      rows: [
        { label: "TSI", value: point.tsi === null ? MISSING : oneDecimal(point.tsi) },
        { label: "Signal", value: point.tsiSignal === null ? MISSING : oneDecimal(point.tsiSignal) },
      ],
    };
  }
  const decimals = point.macd === null ? undefined : macdDecimals(point.macd);
  return {
    date,
    rows: [
      { label: "MACD", value: point.macd === null ? MISSING : macdFigure(point.macd, decimals) },
      { label: "Signal", value: point.macdSignal === null ? MISSING : macdFigure(point.macdSignal, decimals) },
      { label: "Histogramm", value: point.macdHistogram === null ? MISSING : macdFigure(point.macdHistogram, decimals) },
    ],
  };
}

/**
 * Text alternative over the points with a value: e.g. `RSI 01.01.2026 – 04.11.2026: von 48,2 auf 64,3,
 * Zonen 30 und 70`; TSI and MACD name the signal line (and the zero line).
 */
export function technicalAriaLabel(series: readonly TechnicalSeriesPoint[], indicator: TechnicalIndicator): string {
  const name = TECHNICAL_INDICATOR_LABELS[indicator];
  const withValue = series.filter((point) => mainValue(point, indicator) !== null);
  const first = withValue.at(0);
  const last = withValue.at(-1);
  if (!first || !last) return `${name}: keine Daten`;
  const head = `${name} ${formatDate(first.date)} – ${formatDate(last.date)}`;
  // MACD: one precision for the whole sentence, from the last MACD value (as the row).
  const decimals = indicator === "macd" ? macdDecimals(mainValue(last, indicator)!) : 1;
  const format = (value: string) => formatFigure(value, decimals);
  const range = `von ${format(mainValue(first, indicator)!)} auf ${format(mainValue(last, indicator)!)}`;
  if (indicator === "rsi") {
    const { oversold, overbought } = TECHNICAL_PARAMETERS.rsi;
    return `${head}: ${range}, Zonen ${oversold} und ${overbought}`;
  }
  const signal = signalValue(last, indicator);
  return `${head}: ${range}, Signallinie zuletzt ${signal === null ? MISSING : format(signal)}, Nulllinie`;
}

/**
 * The value formatters handed to x-charts: x ticks the compact date label over the Period's span, tooltip
 * and screen-reader descriptions the full date; y ticks a plain figure.
 */
export function technicalFormatters(series: readonly TechnicalSeriesPoint[], from: string, to: string) {
  const span = spanDays(periodDates(from, to));
  const dateByTime = new Map(series.map((point) => [utcDate(point.date).getTime(), point.date]));
  return {
    x: (date: Date, context?: { location?: string }): string => {
      if (context?.location === "tick") return tickLabel(date, span);
      const isoDate = dateByTime.get(date.getTime());
      return isoDate === undefined ? "" : formatDate(isoDate);
    },
    y: (value: number): string => formatQuantity(String(Number(value.toPrecision(12)))),
  };
}
