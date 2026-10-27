import { describe, expect, it } from "vitest";
import { comparisonAriaLabel, comparisonByDate, comparisonTooltipLines, toComparisonPlotData } from "./comparison-chart";

const NBSP = " ";
const LINE = [
  { date: "2026-01-31", performance: "0" },
  { date: "2026-02-01", performance: "0.1" },
  { date: "2026-02-02", performance: "0.134375" },
];
const WORLD = [
  { date: "2026-01-31", performance: "0" },
  { date: "2026-02-02", performance: "0.03" },
];

describe("toComparisonPlotData", () => {
  it("aligns the comparison to the scope's days by date", () => {
    expect(toComparisonPlotData(LINE, WORLD)).toEqual({
      dates: [new Date("2026-01-31T00:00:00Z"), new Date("2026-02-01T00:00:00Z"), new Date("2026-02-02T00:00:00Z")],
      scope: [0, 0.1, 0.134375],
      comparison: [0, null, 0.03],
    });
    expect(toComparisonPlotData(LINE, null).comparison).toEqual([null, null, null]);
  });
});

describe("comparisonTooltipLines", () => {
  it("gives the date, the scope row and the comparison row (– on a missing day)", () => {
    const comparison = { label: "MSCI World", byDate: comparisonByDate(WORLD) };
    expect(comparisonTooltipLines(LINE[2], "Portfolio", comparison)).toEqual({
      date: "02.02.2026",
      rows: [
        { label: "Portfolio", value: `+13,44${NBSP}%` },
        { label: "MSCI World", value: `+3,00${NBSP}%` },
      ],
    });
    expect(comparisonTooltipLines(LINE[1], "Portfolio", comparison).rows[1]).toEqual({ label: "MSCI World", value: "–" });
    expect(comparisonTooltipLines(LINE[0], "Portfolio", null).rows).toEqual([{ label: "Portfolio", value: "0,00 %" }]);
  });
});

describe("comparisonAriaLabel", () => {
  it("names the range and each line's last performance", () => {
    expect(comparisonAriaLabel(LINE, "Portfolio", { label: "MSCI World", line: WORLD })).toBe(
      `Performance 31.01.2026 – 02.02.2026: Portfolio +13,44${NBSP}%, MSCI World +3,00${NBSP}%`,
    );
    expect(comparisonAriaLabel(LINE, "Portfolio", null)).toBe(`Performance 31.01.2026 – 02.02.2026: Portfolio +13,44${NBSP}%`);
    expect(comparisonAriaLabel([], "Portfolio", null)).toBe("Performance: keine Daten");
  });
});
