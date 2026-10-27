import { describe, expect, it } from "vitest";
import {
  averageTooltipLine,
  hasAverage,
  noAverageText,
  hasPriceHistory,
  type PriceChartPoint,
  type PriceChartTrade,
  priceChartAriaLabel,
  priceTooltipLines,
  priceXFormatter,
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
