import { describe, expect, it } from "vitest";
import type { TechnicalSeriesPoint } from "@/core/technical";
import {
  hasIndicatorValues,
  macdDecimals,
  periodDates,
  technicalAriaLabel,
  technicalFormatters,
  technicalPlotData,
  technicalRows,
  technicalSourceLine,
  technicalTooltipLines,
  type TechnicalSignals,
} from "./technical-labels";

const NBSP = " ";
const INSUFFICIENT = { value: null, reason: "insufficient-history" } as const;
const DATE = "2026-11-04";

const FULL: TechnicalSignals = {
  trend: { value: "0.0821", date: DATE, key: "up", label: "Aufwärtstrend", sma200: "100" },
  rsi: { value: "64.27", date: DATE, key: "neutral", label: "neutral" },
  macd: { value: "1.2312", date: DATE, key: "positive-turning-up", label: "positiv, dreht nach oben", signal: "0.9812", histogram: "0.25" },
  tsi: { value: "12.43", date: DATE, key: "positive", label: "Schwung positiv", signal: "9.08" },
  fiftyTwoWeeks: {
    value: "-0.031",
    date: DATE,
    key: "near-high",
    label: "nahe Hoch",
    high: { price: "120", date: "2026-10-01" },
    low: { price: "80", date: "2026-03-01" },
  },
};

const point = (date: string, values: Partial<TechnicalSeriesPoint> = {}): TechnicalSeriesPoint => ({
  date,
  rsi: null,
  macd: null,
  macdSignal: null,
  macdHistogram: null,
  tsi: null,
  tsiSignal: null,
  ...values,
});

describe("technicalRows", () => {
  it("formats the five rows of the I/O matrix with label and tone", () => {
    expect(technicalRows(FULL)).toEqual([
      { signal: "Trend", value: `+8,2${NBSP}% zum 200-Tage-Schnitt`, label: "Aufwärtstrend", tone: "gain" },
      { signal: "RSI", value: "64,3", label: "neutral", tone: null },
      { signal: "MACD", value: "1,23 (Signal 0,98)", label: "positiv, dreht nach oben", tone: "gain" },
      { signal: "TSI", value: "12,4 (Signal 9,1)", label: "Schwung positiv", tone: "gain" },
      { signal: "52 Wochen", value: `-3,1${NBSP}% zum 52-Wochen-Hoch`, label: "nahe Hoch", tone: "gain" },
    ]);
  });

  it("shows four decimals for a MACD below 1 in absolute value", () => {
    const rows = technicalRows({
      ...FULL,
      macd: { value: "-0.012345", date: DATE, key: "negative", label: "negativ", signal: "-0.00987", histogram: "-0.002475" },
    });
    expect(rows[2]).toEqual({ signal: "MACD", value: "-0,0123 (Signal -0,0099)", label: "negativ", tone: "loss" });
    expect(macdDecimals("0.9999")).toBe(4);
    expect(macdDecimals("-1")).toBe(2);
  });

  it("maps every key to its tone", () => {
    const tones = (signals: Partial<TechnicalSignals>) => technicalRows({ ...FULL, ...signals }).map((row) => row.tone);
    expect(tones({ trend: { ...FULL.trend, value: "-0.1", key: "down", label: "Abwärtstrend" } as TechnicalSignals["trend"] })[0]).toBe("loss");
    expect(tones({ trend: { ...FULL.trend, key: "sideways", label: "Seitwärts" } as TechnicalSignals["trend"] })[0]).toBeNull();
    expect(tones({ rsi: { value: "75", date: DATE, key: "overbought", label: "überkauft" } })[1]).toBe("stale");
    expect(tones({ rsi: { value: "25", date: DATE, key: "oversold", label: "überverkauft" } })[1]).toBe("stale");
    expect(tones({ macd: { ...FULL.macd, key: "positive", label: "positiv" } as TechnicalSignals["macd"] })[2]).toBe("gain");
    expect(tones({ macd: { ...FULL.macd, key: "negative-turning-down", label: "x" } as TechnicalSignals["macd"] })[2]).toBe("loss");
    expect(tones({ tsi: { ...FULL.tsi, key: "negative", label: "x" } as TechnicalSignals["tsi"] })[3]).toBe("loss");
    expect(tones({ tsi: { ...FULL.tsi, key: "fading", label: "x" } as TechnicalSignals["tsi"] })[3]).toBe("stale");
    expect(tones({ tsi: { ...FULL.tsi, key: "turning", label: "x" } as TechnicalSignals["tsi"] })[3]).toBe("stale");
    const week = FULL.fiftyTwoWeeks as Extract<TechnicalSignals["fiftyTwoWeeks"], { key: string }>;
    expect(tones({ fiftyTwoWeeks: { ...week, key: "near-low", label: "nahe Tief" } })[4]).toBe("loss");
    expect(tones({ fiftyTwoWeeks: { ...week, key: "between", label: "dazwischen" } })[4]).toBeNull();
  });

  it("insufficient history: no value, label or tone", () => {
    const rows = technicalRows({ ...FULL, trend: { ...INSUFFICIENT } });
    expect(rows[0]).toEqual({ signal: "Trend", value: null, label: null, tone: null });
    expect(rows.slice(1).every((row) => row.value !== null)).toBe(true);
  });
});

describe("technicalSourceLine", () => {
  it("names the last close date in de-DE format", () => {
    expect(technicalSourceLine(DATE)).toBe("berechnet aus Schlusskursen, Stand 04.11.2026");
  });
});

describe("plot data, tooltip and text alternative", () => {
  const series = [
    point("2026-11-02", { rsi: "48.21", tsi: null }),
    point("2026-11-03", { rsi: "55", macd: "0.5", macdSignal: "0.75", macdHistogram: "-0.25", tsi: "3.14", tsiSignal: "2" }),
    point("2026-11-04", { rsi: "64.27", macd: "1.5", macdSignal: "1", macdHistogram: "0.5", tsi: "12.43", tsiSignal: "9.08" }),
  ];

  it("plots numbers per indicator with gaps as null and the histogram split by sign", () => {
    const rsi = technicalPlotData(series, "rsi");
    expect(rsi.dates.map((date) => date.toISOString().slice(0, 10))).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(rsi.main).toEqual([48.21, 55, 64.27]);
    expect(rsi.signal).toEqual([null, null, null]);
    expect(rsi.histogramPositive).toEqual([null, null, null]);
    const macd = technicalPlotData(series, "macd");
    expect(macd.main).toEqual([null, 0.5, 1.5]);
    expect(macd.signal).toEqual([null, 0.75, 1]);
    expect(macd.histogramPositive).toEqual([null, 0, 0.5]);
    expect(macd.histogramNegative).toEqual([null, -0.25, 0]);
    expect(technicalPlotData(series, "tsi").main).toEqual([null, 3.14, 12.43]);
  });

  it("knows whether the indicator has values", () => {
    expect(hasIndicatorValues(series, "tsi")).toBe(true);
    expect(hasIndicatorValues([point("2026-11-02", { rsi: "50" })], "tsi")).toBe(false);
    expect(hasIndicatorValues([], "rsi")).toBe(false);
  });

  it("formats tooltip lines from the decimal strings", () => {
    expect(technicalTooltipLines(series[2], "rsi")).toEqual({ date: "04.11.2026", rows: [{ label: "RSI", value: "64,3" }] });
    expect(technicalTooltipLines(series[0], "tsi")).toEqual({
      date: "02.11.2026",
      rows: [
        { label: "TSI", value: "–" },
        { label: "Signal", value: "–" },
      ],
    });
    expect(technicalTooltipLines(series[1], "macd").rows).toEqual([
      { label: "MACD", value: "0,5000" },
      { label: "Signal", value: "0,7500" },
      { label: "Histogramm", value: "-0,2500" },
    ]);
  });

  it("text alternative names the indicator, dates, first and last value", () => {
    expect(technicalAriaLabel(series, "rsi")).toBe("RSI 02.11.2026 – 04.11.2026: von 48,2 auf 64,3, Zonen 30 und 70");
    expect(technicalAriaLabel(series, "tsi")).toBe("TSI 03.11.2026 – 04.11.2026: von 3,1 auf 12,4, Signallinie zuletzt 9,1, Nulllinie");
    expect(technicalAriaLabel(series, "macd")).toBe(
      "MACD 03.11.2026 – 04.11.2026: von 0,50 auf 1,50, Signallinie zuletzt 1,00, Nulllinie",
    );
    expect(technicalAriaLabel([], "rsi")).toBe("RSI: keine Daten");
  });

  it("x-axis covers every Period day; ticks are compact, tooltips the full date", () => {
    const days = periodDates("2026-10-31", "2026-11-04");
    expect(days).toHaveLength(5);
    expect(days[0].toISOString()).toBe("2026-10-31T00:00:00.000Z");
    const format = technicalFormatters(series, "2026-10-31", "2026-11-04");
    expect(format.x(days[3], { location: "tick" })).toBe("03.11.");
    expect(format.x(days[3], { location: "tooltip" })).toBe("03.11.2026");
    expect(format.x(days[0], { location: "tooltip" })).toBe("");
    expect(format.y(70)).toBe("70");
    expect(format.y(0.30000000000000004)).toBe("0,3");
  });
});
