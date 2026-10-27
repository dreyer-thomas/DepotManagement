import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS as NONE } from "./corporate-actions";
import { addDays } from "./dates";
import { drawdown, type DrawdownLevel } from "./drawdown";
import type { PriceObservation } from "./prices";
import { type FlowRow, ttwror, ttwrorIndex } from "./returns";
import { securityPriceSeries } from "./security";
import { type ValuationPoint, type ValuationRow, valuationSeries } from "./valuation";

/** A synthetic point; the other fields do not matter for returns. */
function point(date: string, value: string): ValuationPoint {
  return { date, value, positionsValue: "0", cash: value, investedCapital: "0" };
}

const flow = (type: string, date: string, amount: string): FlowRow => ({ type, date, amount, tax: "0" });

const levels = (entries: [string, string | null][]): DrawdownLevel[] => entries.map(([date, level]) => ({ date, level }));

describe("ttwrorIndex", () => {
  it("chains daily factors, inflows at day start: a Deposit inside a decline is not a gain", () => {
    const start = point("2026-01-31", "100");
    const series = [
      point("2026-02-01", "110"),
      point("2026-02-02", "99"),
      point("2026-02-03", "178.2"),
      point("2026-02-04", "198"),
      point("2026-02-05", "220"),
      point("2026-02-06", "209"),
    ];
    const rows = [flow("DEPOSIT", "2026-02-03", "99")];
    const index = ttwrorIndex(start, series, rows);
    expect(index.map((p) => p.level)).toEqual(["1.1", "0.99", "0.891", "0.99", "1.1", "1.045"]);
    expect(new Decimal(index.at(-1)!.level).minus(1).toFixed()).toBe(ttwror(start, series, rows));
  });

  it("carries the level on skipped days (nothing invested) and is empty without a series", () => {
    const start = point("2026-01-31", "0");
    const series = [point("2026-02-01", "0"), point("2026-02-02", "100"), point("2026-02-03", "105")];
    const rows = [flow("DEPOSIT", "2026-02-02", "100")];
    expect(ttwrorIndex(start, series, rows).map((p) => p.level)).toEqual(["1", "1", "1.05"]);
    expect(ttwrorIndex(start, [], rows)).toEqual([]);
  });
});

describe("drawdown", () => {
  it("Flow inside decline: drawdown on the TTWROR index, recovered phase", () => {
    const start = point("2026-01-31", "100");
    const series = [
      point("2026-02-01", "110"),
      point("2026-02-02", "99"),
      point("2026-02-03", "178.2"),
      point("2026-02-04", "198"),
      point("2026-02-05", "220"),
      point("2026-02-06", "209"),
    ];
    const result = drawdown(ttwrorIndex(start, series, [flow("DEPOSIT", "2026-02-03", "99")]), { date: start.date, level: "1" });
    expect(result.points).toEqual([
      { date: "2026-02-01", drawdown: "0" },
      { date: "2026-02-02", drawdown: "-0.1" },
      { date: "2026-02-03", drawdown: "-0.19" },
      { date: "2026-02-04", drawdown: "-0.1" },
      { date: "2026-02-05", drawdown: "0" },
      { date: "2026-02-06", drawdown: "-0.05" },
    ]);
    expect(result.current).toBe("-0.05");
    expect(result.max).toBe("-0.19");
    expect(result.phase).toEqual({ peak: "2026-02-01", end: "2026-02-05", recovered: true, days: 4 });
  });

  it("Unrecovered: the phase ends on the last point, the first level seeds the peak", () => {
    const result = drawdown(
      levels([
        ["2026-03-01", "100"],
        ["2026-03-02", "120"],
        ["2026-03-03", "90"],
        ["2026-03-04", "100"],
      ]),
    );
    expect(result.points.map((p) => p.drawdown)).toEqual(["0", "0", "-0.25", "-0.16666666666666666667"]);
    expect(result.max).toBe("-0.25");
    expect(result.current).toBe("-0.16666666666666666667");
    expect(result.phase).toEqual({ peak: "2026-03-02", end: "2026-03-04", recovered: false, days: 2 });
  });

  it("Split in Period: split-adjusted prices never show the split as a drop", () => {
    const actions: CorporateActions = {
      splits: [{ securityId: "s1", date: "2026-04-02", ratioOld: "1", ratioNew: "2" }],
      isinChanges: [],
    };
    const observation = (date: string, price: string): PriceObservation => ({
      id: `p-${date}`,
      securityId: "s1",
      date,
      sequence: 0,
      price,
      source: "provider",
    });
    const prices = securityPriceSeries([observation("2026-04-01", "100"), observation("2026-04-02", "51")], "s1", actions, "2026-04-01", "2026-04-02");
    expect(prices.map((p) => p.price)).toEqual(["50", "51"]);
    const result = drawdown(prices.map((p) => ({ date: p.date, level: p.price })));
    expect(result.points.map((p) => p.drawdown)).toEqual(["0", "0"]);
    expect(result.max).toBe("0");
    expect(result.phase).toBeNull();
  });

  it("New peak: the last level is the highest → current 0", () => {
    const result = drawdown(
      levels([
        ["2026-03-01", "100"],
        ["2026-03-02", "80"],
        ["2026-03-03", "130"],
      ]),
    );
    expect(result.current).toBe("0");
    expect(result.max).toBe("-0.2");
    expect(result.phase).toEqual({ peak: "2026-03-01", end: "2026-03-03", recovered: true, days: 2 });
  });

  it("No decline: all 0, max 0, no phase", () => {
    const result = drawdown(
      levels([
        ["2026-03-01", "100"],
        ["2026-03-02", "100"],
        ["2026-03-03", "101"],
      ]),
      { date: "2026-02-28", level: "100" },
    );
    expect(result.points.map((p) => p.drawdown)).toEqual(["0", "0", "0"]);
    expect(result).toMatchObject({ current: "0", max: "0", phase: null });
  });

  it("Nothing invested: days before the first Deposit keep index 1 and drawdown 0", () => {
    const rows: (ValuationRow & { id: string })[] = [
      { id: "t1", securityId: null, type: "DEPOSIT", date: "2026-05-03", sequence: 1, quantity: null, price: null, amount: "1000", fee: "0", tax: "0" },
    ];
    const points = valuationSeries(rows, [], NONE, addDays("2026-05-01", -1), "2026-05-04");
    const start = points[0];
    const series = points.slice(1);
    const index = ttwrorIndex(start, series, rows);
    expect(index.map((p) => p.level)).toEqual(["1", "1", "1", "1"]);
    const result = drawdown(index, { date: start.date, level: "1" });
    expect(result.points.map((p) => p.drawdown)).toEqual(["0", "0", "0", "0"]);
    expect(result).toMatchObject({ current: "0", max: "0", phase: null });
    expect(ttwror(start, series, rows)).toBe("0");
  });

  it("No price: null levels give null drawdowns and null KPIs", () => {
    const result = drawdown(
      levels([
        ["2026-03-01", null],
        ["2026-03-02", null],
      ]),
    );
    expect(result).toEqual({
      points: [
        { date: "2026-03-01", drawdown: null },
        { date: "2026-03-02", drawdown: null },
      ],
      current: null,
      max: null,
      phase: null,
    });
  });

  it("Null days before the first price: the first price seeds the peak, current is the last priced day", () => {
    const result = drawdown(
      levels([
        ["2026-03-01", null],
        ["2026-03-02", "10"],
        ["2026-03-03", "9"],
      ]),
    );
    expect(result.points.map((p) => p.drawdown)).toEqual([null, "0", "-0.1"]);
    expect(result.current).toBe("-0.1");
    expect(result.phase).toEqual({ peak: "2026-03-02", end: "2026-03-03", recovered: false, days: 1 });
  });

  it("Empty: no points, null KPIs", () => {
    expect(drawdown([])).toEqual({ points: [], current: null, max: null, phase: null });
    expect(drawdown([], { date: "2026-01-01", level: "1" })).toEqual({ points: [], current: null, max: null, phase: null });
  });

  it("Tie: the earlier trough defines the phase; the peak date is the latest date at the peak", () => {
    const result = drawdown(
      levels([
        ["2026-03-01", "100"],
        ["2026-03-02", "90"],
        ["2026-03-03", "100"],
        ["2026-03-04", "100"],
        ["2026-03-05", "90"],
        ["2026-03-06", "95"],
      ]),
    );
    expect(result.max).toBe("-0.1");
    expect(result.phase).toEqual({ peak: "2026-03-01", end: "2026-03-03", recovered: true, days: 2 });
    // A new dip after the recovery starts from the latest date at the peak.
    const later = drawdown(
      levels([
        ["2026-03-01", "100"],
        ["2026-03-02", "95"],
        ["2026-03-03", "100"],
        ["2026-03-04", "100"],
        ["2026-03-05", "80"],
      ]),
    );
    expect(later.phase).toEqual({ peak: "2026-03-04", end: "2026-03-05", recovered: false, days: 1 });
  });

  it("Parity: last index − 1 equals the Depot's Period TTWROR", () => {
    const rows: (ValuationRow & { id: string })[] = [
      { id: "d1", securityId: null, type: "DEPOSIT", date: "2026-06-01", sequence: 1, quantity: null, price: null, amount: "1000", fee: "0", tax: "0" },
      { id: "b1", securityId: "s1", type: "BUY", date: "2026-06-01", sequence: 2, quantity: "10", price: "50", amount: "500", fee: "1", tax: "0" },
      { id: "d2", securityId: null, type: "DEPOSIT", date: "2026-06-04", sequence: 1, quantity: null, price: null, amount: "300", fee: "0", tax: "0" },
      { id: "w1", securityId: null, type: "WITHDRAWAL", date: "2026-06-06", sequence: 1, quantity: null, price: null, amount: "200", fee: "0", tax: "1.5" },
    ];
    const observations: PriceObservation[] = [
      { id: "b1", securityId: "s1", date: "2026-06-01", sequence: 2, price: "50", source: "transaction" },
      { id: "p2", securityId: "s1", date: "2026-06-03", sequence: 0, price: "47.3", source: "provider" },
      { id: "p3", securityId: "s1", date: "2026-06-05", sequence: 0, price: "53.9", source: "provider" },
      { id: "p4", securityId: "s1", date: "2026-06-07", sequence: 0, price: "51.12", source: "provider" },
    ];
    const points = valuationSeries(rows, observations, NONE, "2026-05-31", "2026-06-08");
    const start = points[0];
    const series = points.slice(1);
    const index = ttwrorIndex(start, series, rows);
    const performance = ttwror(start, series, rows);
    expect(performance).not.toBeNull();
    expect(new Decimal(index.at(-1)!.level).minus(1).toFixed()).toBe(performance);
    expect(index).toHaveLength(series.length);
  });
});
