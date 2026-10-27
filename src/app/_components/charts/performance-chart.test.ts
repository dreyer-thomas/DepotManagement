import { describe, expect, it } from "vitest";
import {
  performanceAriaLabel,
  performanceFormatters,
  performanceTooltipLines,
  performanceYDomain,
  toPerformancePlotData,
} from "./performance-chart";
import type { PriceChartTrade } from "./price-chart";
import { utcDate } from "./value-chart";

const POINTS = [
  { date: "2026-02-01", performance: "0" },
  { date: "2026-02-02", performance: "0.1" },
  { date: "2026-02-03", performance: "0.2" },
  { date: "2026-02-04", performance: "-0.05" },
];

const TRADES: PriceChartTrade[] = [
  { depotName: "Depot A", type: "BUY", date: "2026-02-01", quantity: "10", price: "10", adjusted: false },
  { depotName: "Depot A", type: "SELL", date: "2026-02-03", quantity: "5", price: "12", adjusted: false },
];
const DIVIDENDS = [{ depotName: "Depot A", date: "2026-02-03", amount: "3" }];

describe("toPerformancePlotData", () => {
  it("converts the ratios for plotting and puts markers at the day's performance", () => {
    expect(toPerformancePlotData(POINTS, TRADES, DIVIDENDS)).toEqual({
      dates: POINTS.map((p) => utcDate(p.date)),
      values: [0, 0.1, 0.2, -0.05],
      buys: [0, null, null, null],
      sells: [null, null, 0.2, null],
      dividends: [null, null, 0.2, null],
    });
    expect(toPerformancePlotData(POINTS).sells).toEqual([null, null, null, null]);
  });
});

describe("performanceTooltipLines", () => {
  it("formats the date, the signed performance and lists the day's trades and dividends", () => {
    expect(performanceTooltipLines(POINTS[2], TRADES, DIVIDENDS)).toEqual({
      date: "03.02.2026",
      performance: "+20,00 %",
      events: ["Verkauf · Depot A · 5 Stück à 12,00 €", "Dividende · Depot A · 3,00 €"],
    });
    expect(performanceTooltipLines(POINTS[3])).toEqual({ date: "04.02.2026", performance: "-5,00 %", events: [] });
  });
});

describe("performanceAriaLabel", () => {
  it("names the Period and the last signed performance", () => {
    expect(performanceAriaLabel(POINTS)).toBe("Performance 01.02.2026 – 04.02.2026: -5,00 %");
    expect(performanceAriaLabel(POINTS.slice(0, 3))).toBe("Performance 01.02.2026 – 03.02.2026: +20,00 %");
    expect(performanceAriaLabel([])).toBe("Performance: keine Daten");
  });
});

describe("performanceFormatters", () => {
  it("formats dates, percent ticks and series values from the decimal strings", () => {
    const format = performanceFormatters(POINTS);
    expect(format.x(utcDate("2026-02-02"))).toBe("02.02.2026");
    expect(format.y(0.1)).toBe("+10,00 %");
    expect(format.value(0.1, { dataIndex: 1 })).toBe("+10,00 %");
    expect(format.value(null, { dataIndex: 9 })).toBe("");
  });
});

describe("performanceYDomain", () => {
  it("always includes 0", () => {
    expect(performanceYDomain([0.1, 0.2])).toEqual({ min: 0, max: 0.2 });
    expect(performanceYDomain([-0.1, -0.05])).toEqual({ min: -0.1, max: 0 });
    expect(performanceYDomain([-0.1, 0.3])).toEqual({ min: -0.1, max: 0.3 });
  });
});
