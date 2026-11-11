import { describe, expect, it } from "vitest";
import {
  averageTooltipLine,
  hasAverage,
  noAverageText,
  pivotAriaSuffix,
  pivotCaption,
  pivotLevelLabel,
  pivotLevels,
  pivotThresholdLabel,
  pivotTooltipLine,
  pivotYRange,
  type PriceChartPivotOverlay,
  toPivotPlotData,
  hasPriceHistory,
  type PriceChartPoint,
  type PriceChartTrade,
  priceChartAriaLabel,
  priceTooltipLines,
  priceXFormatter,
  stopTooltipLine,
  toAveragePlotData,
  toPricePlotData,
  tradeLine,
} from "./price-chart";
import { utcDate } from "./value-chart";

const POINTS: PriceChartPoint[] = [
  { date: "2026-10-20", price: null },
  { date: "2026-10-21", price: "50" },
  { date: "2026-10-22", price: "52.345" },
];

const TRADES: PriceChartTrade[] = [
  { depotName: "Alpha", type: "BUY", date: "2026-10-20", quantity: "20", price: "48", adjusted: true },
  { depotName: "Alpha", type: "BUY", date: "2026-10-21", quantity: "2", price: "50.5", adjusted: false },
  { depotName: "Beta", type: "BUY", date: "2026-10-21", quantity: "1.5", price: "49.9", adjusted: false },
  { depotName: "Beta", type: "SELL", date: "2026-10-22", quantity: "4", price: "52", adjusted: false },
];

describe("price chart helpers", () => {
  it("plots the price line with gaps and one marker per day and kind on the day's price", () => {
    const plot = toPricePlotData(POINTS, TRADES);
    expect(plot.dates).toEqual(POINTS.map((point) => utcDate(point.date)));
    expect(plot.prices).toEqual([null, 50, 52.345]);
    // Without a price that day the marker sits on the trade price.
    expect(plot.buys).toEqual([48, 50, null]);
    expect(plot.sells).toEqual([null, null, 52.345]);
  });

  it("formats trade lines, flagging adjusted ones", () => {
    expect(tradeLine(TRADES[0])).toBe("Kauf · Alpha · 20 Stück à 48,00 € (split-bereinigt)");
    expect(tradeLine(TRADES[3])).toBe("Verkauf · Beta · 4 Stück à 52,00 €");
  });

  it("lists the day's price and every trade of that day in the tooltip", () => {
    expect(priceTooltipLines(POINTS[1], TRADES)).toEqual({
      date: "21.10.2026",
      price: "50,00 €",
      trades: ["Kauf · Alpha · 2 Stück à 50,50 €", "Kauf · Beta · 1,5 Stück à 49,90 €"],
    });
    expect(priceTooltipLines(POINTS[0], []).price).toBe("–");
  });

  it("names Period, first and last known price and the trade counts", () => {
    expect(priceChartAriaLabel(POINTS, TRADES)).toBe(
      "Kursverlauf 20.10.2026 – 22.10.2026: Kurs von 50,00 € auf 52,35 €, 3 Käufe, 1 Verkauf",
    );
    expect(priceChartAriaLabel(POINTS, [])).toContain("0 Käufe, 0 Verkäufe");
    expect(priceChartAriaLabel([{ date: "2026-10-20", price: null }], [])).toBe("Kursverlauf: keine Daten");
  });

  it("moving-average overlay: plot by date, tooltip line and aria suffix", () => {
    const averages = [
      { date: "2026-10-21", average: null },
      { date: "2026-10-22", average: "51.25" },
    ];
    expect(toAveragePlotData(POINTS, averages)).toEqual([null, null, 51.25]);
    expect(averageTooltipLine("2026-10-22", { window: "38", points: averages })).toEqual({ label: "GD 38", value: "51,25\u00a0€" });
    expect(averageTooltipLine("2026-10-21", { window: "200", points: averages })).toEqual({ label: "GD 200", value: "–" });
    expect(priceChartAriaLabel(POINTS, TRADES, "38")).toBe(
      "Kursverlauf 20.10.2026 – 22.10.2026: Kurs von 50,00\u00a0€ auf 52,35\u00a0€, 3 Käufe, 1 Verkauf, mit gleitendem Durchschnitt 38 Tage",
    );
  });

  it("knows whether the overlay has any average and words the missing-average caption", () => {
    expect(hasAverage(undefined)).toBe(false);
    expect(hasAverage({ window: "200", points: [{ date: "2026-10-21", average: null }] })).toBe(false);
    expect(hasAverage({ window: "38", points: [{ date: "2026-10-21", average: "1" }] })).toBe(true);
    expect(noAverageText("200")).toBe("Zu wenig gespeicherte Kurse für GD 200.");
  });

  it("knows whether any price exists", () => {
    expect(hasPriceHistory(POINTS)).toBe(true);
    expect(hasPriceHistory([{ date: "2026-10-20", price: null }])).toBe(false);
  });

  it("formats ticks compactly and tooltip dates in full", () => {
    const format = priceXFormatter(POINTS);
    expect(format(utcDate("2026-10-21"), { location: "tick" })).toBe("21.10.");
    expect(format(utcDate("2026-10-21"), { location: "tooltip" })).toBe("21.10.2026");
    expect(format(utcDate("2026-10-25"))).toBe("");
  });
});

describe("pivots overlay helpers", () => {
  const OVERLAY: PriceChartPivotOverlay = {
    threshold: "8",
    pivots: [
      { date: "2026-01-01", price: "100", kind: "low" },
      { date: "2026-01-03", price: "120", kind: "high" },
      { date: "2026-01-05", price: "100", kind: "low" },
    ],
    retracements: [
      { ratio: "0.382", price: "107.64" },
      { ratio: "0.5", price: "110" },
      { ratio: "0.618", price: "112.36" },
    ],
    extension: { ratio: "1.618", price: "87.64" },
  };
  const NO_LEVELS = { retracements: [], extension: null };
  const POINTS_7: PriceChartPoint[] = ["100", "110", "120", "108", "100", "112", "115"].map((price, index) => ({
    date: `2026-01-0${index + 1}`,
    price,
  }));

  it("labels levels with ratio and price", () => {
    expect(pivotThresholdLabel("12")).toBe("12\u00a0%");
    expect(pivotLevels(OVERLAY).map(pivotLevelLabel)).toEqual([
      "38,2\u00a0% · 107,64\u00a0€",
      "50\u00a0% · 110,00\u00a0€",
      "61,8\u00a0% · 112,36\u00a0€",
      "161,8\u00a0% · 87,64\u00a0€",
    ]);
    expect(pivotLevels({ ...OVERLAY, extension: null })).toHaveLength(3);
  });

  it("captions without pivots and with a single pivot; none with a completed swing", () => {
    expect(pivotCaption({ threshold: "8", pivots: [], ...NO_LEVELS })).toBe("Keine Wendepunkte ab 8\u00a0% im Zeitraum.");
    expect(pivotCaption({ threshold: "12", pivots: [OVERLAY.pivots[0]], ...NO_LEVELS })).toBe(
      "Keine abgeschlossene Bewegung ab 12\u00a0% im Zeitraum.",
    );
    expect(pivotCaption(OVERLAY)).toBeNull();
  });

  it("plots the ZigZag only on pivot dates", () => {
    expect(toPivotPlotData(POINTS_7, OVERLAY.pivots)).toEqual([100, null, 120, null, 100, null, null]);
  });

  it("widens the y range to every drawn level", () => {
    const range = pivotYRange([100, 120, null], OVERLAY)!;
    expect(range.min).toBeLessThan(87.64);
    expect(range.max).toBeGreaterThan(120);
    expect(pivotYRange([100, 120], undefined)).toBeNull();
    expect(pivotYRange([100, 120], { ...OVERLAY, ...NO_LEVELS })).toBeNull();
  });

  it("tooltip line on pivot days only", () => {
    expect(pivotTooltipLine("2026-01-03", OVERLAY)).toEqual({ label: "Wendepunkt", value: "Hoch" });
    expect(pivotTooltipLine("2026-01-05", OVERLAY)).toEqual({ label: "Wendepunkt", value: "Tief" });
    expect(pivotTooltipLine("2026-01-04", OVERLAY)).toBeNull();
  });

  it("appends the pivots and levels to the text alternative", () => {
    const suffix =
      ", mit Wendepunkten ab 8\u00a0%: 3 Wendepunkte, Fibonacci 38,2\u00a0% 107,64\u00a0€, 50\u00a0% 110,00\u00a0€, " +
      "61,8\u00a0% 112,36\u00a0€, 161,8\u00a0% 87,64\u00a0€";
    expect(pivotAriaSuffix(OVERLAY)).toBe(suffix);
    expect(priceChartAriaLabel(POINTS_7, [], undefined, OVERLAY)).toMatch(new RegExp(`${suffix}$`));
    expect(pivotAriaSuffix({ ...OVERLAY, pivots: [OVERLAY.pivots[0]], ...NO_LEVELS })).toBe(
      ", mit Wendepunkten ab 8\u00a0%: 1 Wendepunkt",
    );
  });

  it("never outputs a wave count", () => {
    const texts = [
      pivotAriaSuffix(OVERLAY),
      ...pivotLevels(OVERLAY).map(pivotLevelLabel),
      pivotCaption({ threshold: "5", pivots: [], ...NO_LEVELS }),
      pivotCaption({ threshold: "5", pivots: [OVERLAY.pivots[0]], ...NO_LEVELS }),
      ...OVERLAY.pivots.map((pivot) => pivotTooltipLine(pivot.date, OVERLAY)?.value),
    ].join("\n");
    expect(texts).not.toMatch(/Welle|Elliott|\bWave\b|\(\s*[1-5ABC]\s*\)|\b[ABC]\b/);
  });
});

describe("price marks overlay helpers", () => {
  it("stopTooltipLine: the trailing stop of a day as money, null otherwise", () => {
    const marks = {
      stop: {
        kind: "trailing" as const,
        points: [
          { date: "2026-10-21", value: null },
          { date: "2026-10-22", value: "89.25" },
        ],
      },
      target: null,
    };
    expect(stopTooltipLine("2026-10-22", marks)).toEqual({ label: "Stopp", value: "89,25\u00a0€" });
    expect(stopTooltipLine("2026-10-21", marks)).toBeNull();
    expect(stopTooltipLine("2026-10-23", marks)).toBeNull();
    expect(stopTooltipLine("2026-10-22", { stop: { kind: "fixed", value: "90" }, target: "120" })).toBeNull();
    expect(stopTooltipLine("2026-10-22", { stop: null, target: null })).toBeNull();
    expect(stopTooltipLine("2026-10-22", undefined)).toBeNull();
  });
});
