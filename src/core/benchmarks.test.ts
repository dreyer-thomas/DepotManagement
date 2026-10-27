import { describe, expect, it } from "vitest";
import {
  BENCHMARKS,
  benchmarkStartDate,
  indexPerformanceLine,
  performanceLine,
  priceReturnLine,
  returnDifference,
} from "./benchmarks";
import { NO_CORPORATE_ACTIONS } from "./corporate-actions";
import type { PriceObservation } from "./prices";
import { ttwror } from "./returns";
import { securityPriceSeries } from "./security";
import type { ValuationPoint } from "./valuation";

const point = (date: string, value: string): ValuationPoint => ({
  date,
  value,
  positionsValue: value,
  cash: "0",
  investedCapital: value,
});
const flow = (type: string, date: string, amount: string) => ({ type, date, amount, tax: "0" });

describe("BENCHMARKS", () => {
  it("lists the four index ETFs with their ISINs in select order", () => {
    expect(BENCHMARKS.map(({ key, label, isin }) => [key, label, isin])).toEqual([
      ["msci-world", "MSCI World", "IE00B4L5Y983"],
      ["msci-acwi", "MSCI ACWI", "IE00B6R52259"],
      ["dax", "DAX", "DE0005933931"],
      ["sp500", "S&P 500", "IE00B5BMR087"],
    ]);
  });
});

describe("benchmarkStartDate", () => {
  it("is ten days before the 3J preset start on a ledger younger than three years", () => {
    expect(benchmarkStartDate("2026-03-05", "2026-10-27")).toBe("2023-10-17");
  });

  it("is ten days before the earliest ledger date on an older ledger", () => {
    expect(benchmarkStartDate("2022-03-05", "2026-10-27")).toBe("2022-02-23");
  });

  it("clamps the preset start to the month end like resolvePeriod", () => {
    expect(benchmarkStartDate("2026-10-01", "2028-02-29")).toBe("2025-02-18");
  });
});

describe("performanceLine", () => {
  it("starts at 0 on start.date and treats a Deposit as a flow (1650 / 1600 on d2)", () => {
    const start = point("2026-02-01", "1000");
    const series = [point("2026-02-02", "1100"), point("2026-02-03", "1650")];
    const rows = [flow("DEPOSIT", "2026-02-03", "500")];
    const line = performanceLine(start, series, rows);
    expect(line).toEqual([
      { date: "2026-02-01", performance: "0" },
      { date: "2026-02-02", performance: "0.1" },
      { date: "2026-02-03", performance: "0.134375" },
    ]);
    expect(line.at(-1)?.performance).toBe(ttwror(start, series, rows));
  });

  it("is only the start point for an empty series", () => {
    expect(performanceLine(point("2026-02-01", "0"), [], [])).toEqual([{ date: "2026-02-01", performance: "0" }]);
  });
});

describe("indexPerformanceLine", () => {
  it("prepends the start point and subtracts 1 from each level", () => {
    expect(indexPerformanceLine("2026-02-01", [{ date: "2026-02-02", level: "0.95" }])).toEqual([
      { date: "2026-02-01", performance: "0" },
      { date: "2026-02-02", performance: "-0.05" },
    ]);
  });
});

describe("priceReturnLine", () => {
  const close = (date: string, price: string): PriceObservation => ({
    id: date,
    securityId: "b",
    date,
    sequence: 0,
    price,
    source: "provider",
  });

  it("bases a weekend start on Friday's close, carried forward (Sat/Sun 0, Mon +3 %)", () => {
    const prices = securityPriceSeries(
      [close("2026-02-06", "100"), close("2026-02-09", "103")],
      "b",
      NO_CORPORATE_ACTIONS,
      "2026-02-07",
      "2026-02-09",
    );
    expect(priceReturnLine(prices)).toEqual([
      { date: "2026-02-07", performance: "0" },
      { date: "2026-02-08", performance: "0" },
      { date: "2026-02-09", performance: "0.03" },
    ]);
  });

  it("is null without a close on or before the start date, or for a zero base", () => {
    const later = securityPriceSeries([close("2026-02-09", "103")], "b", NO_CORPORATE_ACTIONS, "2026-02-07", "2026-02-09");
    expect(priceReturnLine(later)).toBeNull();
    expect(priceReturnLine([])).toBeNull();
    expect(priceReturnLine([{ date: "2026-02-07", price: "0" }, { date: "2026-02-08", price: "1" }])).toBeNull();
  });
});

describe("returnDifference", () => {
  it("is scope minus comparison, null when either is missing", () => {
    expect(returnDifference("0.134375", "0.03")).toBe("0.104375");
    expect(returnDifference("-0.05", "0.1")).toBe("-0.15");
    expect(returnDifference(null, "0.1")).toBeNull();
    expect(returnDifference("0.1", undefined)).toBeNull();
  });
});
