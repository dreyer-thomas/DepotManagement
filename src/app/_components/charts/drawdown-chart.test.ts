import { describe, expect, it } from "vitest";
import {
  dividendLine,
  drawdownAriaLabel,
  drawdownFormatters,
  drawdownKpiTexts,
  drawdownTooltipLines,
  drawdownYMin,
  hasDrawdown,
  toDrawdownPlotData,
} from "./drawdown-chart";
import type { PriceChartTrade } from "./price-chart";
import { utcDate } from "./value-chart";

const POINTS = [
  { date: "2026-02-01", drawdown: "0" },
  { date: "2026-02-02", drawdown: "-0.1" },
  { date: "2026-02-03", drawdown: "-0.19" },
  { date: "2026-02-04", drawdown: null },
];

const TRADES: PriceChartTrade[] = [
  { depotName: "Depot A", type: "BUY", date: "2026-02-02", quantity: "10", price: "50", adjusted: false },
  { depotName: "Depot B", type: "SELL", date: "2026-02-03", quantity: "4", price: "45", adjusted: true },
  { depotName: "Depot B", type: "SELL", date: "2026-02-04", quantity: "1", price: "45", adjusted: false },
];
const DIVIDENDS = [{ depotName: "Depot A", date: "2026-02-03", amount: "12" }];

describe("toDrawdownPlotData", () => {
  it("converts the ratios for plotting and puts markers at the day's drawdown (none without one)", () => {
    expect(toDrawdownPlotData(POINTS, TRADES, DIVIDENDS)).toEqual({
      dates: POINTS.map((p) => utcDate(p.date)),
      values: [0, -0.1, -0.19, null],
      buys: [null, -0.1, null, null],
      sells: [null, null, -0.19, null],
      dividends: [null, null, -0.19, null],
    });
    expect(toDrawdownPlotData(POINTS).buys).toEqual([null, null, null, null]);
  });
});

describe("drawdownTooltipLines", () => {
  it("formats the date, the signed drawdown and lists the day's trades and dividends", () => {
    expect(drawdownTooltipLines(POINTS[2], TRADES, DIVIDENDS)).toEqual({
      date: "03.02.2026",
      drawdown: "-19,00\u00a0%",
      events: ["Verkauf · Depot B · 4 Stück à 45,00\u00a0€ (split-bereinigt)", "Dividende · Depot A · 12,00\u00a0€"],
    });
    expect(drawdownTooltipLines(POINTS[3])).toEqual({ date: "04.02.2026", drawdown: "–", events: [] });
    expect(drawdownTooltipLines(POINTS[0]).drawdown).toBe("0,00\u00a0%");
  });

  it("formats a dividend line with the gross amount", () => {
    expect(dividendLine({ depotName: "Depot A", date: "2026-02-03", amount: "1234.5" })).toBe("Dividende · Depot A · 1.234,50\u00a0€");
  });
});

describe("drawdownAriaLabel", () => {
  it("names the Period and the maximum drawdown", () => {
    expect(drawdownAriaLabel(POINTS, "-0.19")).toBe("Drawdown 01.02.2026 – 04.02.2026: maximaler Drawdown -19,00\u00a0%");
    expect(drawdownAriaLabel(POINTS, null)).toBe("Drawdown 01.02.2026 – 04.02.2026: maximaler Drawdown –");
    expect(drawdownAriaLabel([], null)).toBe("Drawdown: keine Daten");
  });
});

describe("drawdownKpiTexts", () => {
  it("recovered phase: signed percents, days and dates", () => {
    expect(
      drawdownKpiTexts({
        current: "-0.05",
        max: "-0.19",
        phase: { peak: "2026-02-01", end: "2026-02-05", recovered: true, days: 4 },
      }),
    ).toEqual({ current: "-5,00\u00a0%", max: "-19,00\u00a0%", duration: "4 Tage", period: "01.02.2026 – 05.02.2026" });
  });

  it("unrecovered phase of one day carries the note", () => {
    expect(
      drawdownKpiTexts({ current: "-0.1", max: "-0.1", phase: { peak: "2026-03-02", end: "2026-03-03", recovered: false, days: 1 } }),
    ).toMatchObject({ duration: "1 Tag", durationNote: "nicht erholt", period: "02.03.2026 – 03.03.2026" });
  });

  it("no decline and no level: dashes", () => {
    expect(drawdownKpiTexts({ current: "0", max: "0", phase: null })).toEqual({
      current: "0,00\u00a0%",
      max: "0,00\u00a0%",
      duration: "–",
      period: "–",
    });
    expect(drawdownKpiTexts({ current: null, max: null, phase: null })).toEqual({ current: "–", max: "–", duration: "–", period: "–" });
  });
});

describe("drawdownFormatters / drawdownYMin / hasDrawdown", () => {
  it("formats ticks, tooltip dates, y percents and values from the strings", () => {
    const format = drawdownFormatters(POINTS);
    expect(format.x(utcDate("2026-02-02"), { location: "tick" })).toBe("02.02.");
    expect(format.x(utcDate("2026-02-02"), { location: "tooltip" })).toBe("02.02.2026");
    expect(format.y(-0.15000000000000002)).toBe("-15,00\u00a0%");
    expect(format.y(0)).toBe("0,00\u00a0%");
    expect(format.value(-0.19, { dataIndex: 2 })).toBe("-19,00\u00a0%");
    expect(format.value(null, { dataIndex: 3 })).toBe("–");
  });

  it("gives the y-axis a range below 0 also without a decline", () => {
    expect(drawdownYMin([0, -0.1, null, -0.19])).toBeCloseTo(-0.1995, 12);
    expect(drawdownYMin([0, -0.1, null, -0.19])).toBeLessThan(-0.19);
    expect(drawdownYMin([0, 0, null])).toBe(-0.01);
    expect(drawdownYMin([])).toBe(-0.01);
  });

  it("detects whether any day has a drawdown", () => {
    expect(hasDrawdown(POINTS)).toBe(true);
    expect(hasDrawdown([{ date: "2026-02-01", drawdown: null }])).toBe(false);
  });
});
