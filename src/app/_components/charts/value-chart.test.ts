import { describe, expect, it } from "vitest";
import { formatDate, formatMoney } from "@/core/format";
import { chartAriaLabel, chartFormatters, spanDays, tickDates, tickLabel, toChartPoints, toPlotData, tooltipLines, utcDate } from "./value-chart";

const POINTS = [
  { date: "2026-01-01", value: "10000", invested: "9000" },
  { date: "2026-06-30", value: "12345.675", invested: "9500.004" },
];

describe("tooltipLines", () => {
  it("formats date and amounts exactly like formatDate / formatMoney on the decimal strings", () => {
    const lines = tooltipLines(POINTS[1]);
    expect(lines).toEqual({ date: formatDate("2026-06-30"), value: formatMoney("12345.675"), invested: formatMoney("9500.004") });
    expect(lines.value).toBe("12.345,68 €");
  });
});

describe("chartAriaLabel", () => {
  it("names the Period and the first/last value and invested capital", () => {
    expect(chartAriaLabel(POINTS)).toBe(
      "Wertentwicklung 01.01.2026 – 30.06.2026: Wert von 10.000,00 € auf 12.345,68 €, " +
        "investiertes Kapital von 9.000,00 € auf 9.500,00 €",
    );
  });

  it("handles a single point and no points", () => {
    expect(chartAriaLabel([POINTS[0]])).toBe(
      "Wertentwicklung 01.01.2026 – 01.01.2026: Wert von 10.000,00 € auf 10.000,00 €, " +
        "investiertes Kapital von 9.000,00 € auf 9.000,00 €",
    );
    expect(chartAriaLabel([])).toBe("Wertentwicklung: keine Daten");
  });
});

describe("toChartPoints / toPlotData", () => {
  it("keeps the series strings and converts only for plotting", () => {
    const points = toChartPoints([
      { date: "2026-01-01", value: "10000", investedCapital: "9000" },
      { date: "2026-01-02", value: "10001.5", investedCapital: "9000" },
    ]);
    expect(points).toEqual([
      { date: "2026-01-01", value: "10000", invested: "9000" },
      { date: "2026-01-02", value: "10001.5", invested: "9000" },
    ]);
    expect(toPlotData(points)).toEqual({
      dates: [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 2))],
      values: [10000, 10001.5],
      invested: [9000, 9000],
    });
  });
});

describe("tickLabel / spanDays", () => {
  it("uses MM.YYYY for month starts of long Periods and DD.MM. otherwise", () => {
    expect(tickLabel(utcDate("2026-01-01"), 365)).toBe("01.2026");
    expect(tickLabel(utcDate("2026-10-25"), 365)).toBe("25.10.");
    expect(tickLabel(utcDate("2026-10-01"), 30)).toBe("01.10.");
  });

  it("counts the days between first and last date", () => {
    expect(spanDays([utcDate("2026-01-01"), utcDate("2026-12-31")])).toBe(364);
    expect(spanDays([utcDate("2026-01-01")])).toBe(0);
    expect(spanDays([])).toBe(0);
  });
});

describe("tickDates", () => {
  const days = (from: string, count: number) =>
    Array.from({ length: count }, (_, i) => new Date(utcDate(from).getTime() + i * 86_400_000));
  const iso = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10));

  it("uses the plotted dates for short Periods, thinned to at most six", () => {
    expect(iso(tickDates(days("2026-10-26", 1)))).toEqual(["2026-10-26"]);
    expect(iso(tickDates(days("2026-10-24", 3)))).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    const month = tickDates(days("2026-09-27", 30));
    expect(month.length).toBeLessThanOrEqual(6);
    expect(new Set(month.map((d) => tickLabel(d, 29))).size).toBe(month.length);
    expect(tickDates([])).toEqual([]);
  });

  it("uses only month starts for long Periods, thinned to at most six", () => {
    // YTD in March: 70 days.
    const ytd = tickDates(days("2026-01-01", 70));
    expect(iso(ytd)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(ytd.map((d) => tickLabel(d, 69))).toEqual(["01.2026", "02.2026", "03.2026"]);
    // 3J: month starts only, at most six, labels distinct.
    const three = tickDates(days("2023-10-27", 1096));
    expect(three.length).toBeGreaterThan(1);
    expect(three.length).toBeLessThanOrEqual(6);
    expect(three.every((d) => d.getUTCDate() === 1 && d.getUTCHours() === 0)).toBe(true);
    expect(three[0].toISOString().slice(0, 10)).toBe("2023-11-01");
    expect(new Set(three.map((d) => tickLabel(d, 1095))).size).toBe(three.length);
  });
});

describe("chartFormatters", () => {
  const points = [
    { date: "2026-10-20", value: "10000", invested: "9000" },
    { date: "2026-10-22", value: "12345.675", invested: "9500" },
  ];

  it("gives ticks the compact label and tooltips / descriptions the full date", () => {
    const format = chartFormatters(points);
    expect(format.x(utcDate("2026-10-22"), { location: "tick" })).toBe("22.10.");
    expect(format.x(utcDate("2026-10-22"), { location: "tooltip" })).toBe("22.10.2026");
  });

  it("formats amounts from the decimal strings by data index, not from the float", () => {
    const format = chartFormatters(points);
    expect(format.value(12345.675, { dataIndex: 1 })).toBe("12.345,68\u00a0€");
    expect(format.invested(9500, { dataIndex: 1 })).toBe("9.500,00\u00a0€");
  });
});
