import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import type { PriceObservation } from "@/core/prices";
import { ExactDecimal } from "@/core/decimal";
import { returnHeatmap } from "@/core/return-heatmap";
import { chainReturns } from "@/core/returns";
import { archiveDepot, benchmarkLines, createDepot, depotValuation, ensureBenchmarkSecurities, ensureSecurity, portfolioValuation, recordIsinChange, returnSeries, recordTransaction, type RecordTransactionInput, valuationSummary } from "./index";

let testDb: TestDatabase;
let depotId: string;
let otherDepotId: string;
let appleId: string;

const db = () => testDb.client;
const TODAY = "2026-10-26";

beforeEach(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
  const other = await createDepot({ name: "Zweitdepot", broker: "FINANZEN_ZERO" }, db());
  if (!depot.ok || !other.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
  otherDepotId = other.depot.id;
  const apple = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" }, db());
  if (!apple.ok) throw new Error("setup failed");
  appleId = apple.security.id;
});

afterEach(async () => {
  await testDb.cleanup();
});

async function book(input: Omit<RecordTransactionInput, "depotId"> & { depotId?: string }) {
  const result = await recordTransaction({ depotId, ...input }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction;
}

describe("depotValuation", () => {
  it("returns the series and Period flows of the Depot for the selected Period", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "2000" });
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", fee: "5", security: { id: appleId } });
    await book({ type: "DIVIDEND", date: "2026-03-01", amount: "50", tax: "15", security: { id: appleId } });
    await book({ type: "TAX", date: "2026-03-03", tax: "-20" });
    // A later trade in another Depot prices the Position too.
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-01-01", amount: "1000" });
    await book({ depotId: otherDepotId, type: "BUY", date: "2026-06-01", quantity: "1", price: "120", security: { id: appleId } });

    const valuation = await depotValuation(depotId, { kind: "custom", from: "2026-01-01", to: "2026-06-30" }, TODAY, db());
    expect(valuation.from).toBe("2026-01-01");
    expect(valuation.to).toBe("2026-06-30");
    expect(valuation.series).toHaveLength(181);
    expect(valuation.series[0]).toEqual({ date: "2026-01-01", value: "0", positionsValue: "0", cash: "0", investedCapital: "0" });
    expect(valuation.series.at(-1)).toEqual({
      date: "2026-06-30",
      value: "2250",
      positionsValue: "1200",
      cash: "1050",
      investedCapital: "1005",
    });
    expect(valuation.dividends).toBe("50");
    expect(valuation.taxesPaid).toBe("-5");
  });

  it("gives the chart point of every date the figures of a Period ending on that date", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "5000" });
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", fee: "5", security: { id: appleId } });
    await book({ type: "BUY", date: "2026-04-15", quantity: "5", price: "130.333", security: { id: appleId } });
    await book({ type: "SELL", date: "2026-07-01", quantity: "8", price: "140", fee: "2.5", security: { id: appleId } });
    await book({ type: "DIVIDEND", date: "2026-08-01", amount: "12.34", tax: "3", security: { id: appleId } });
    const stored: PriceObservation[] = ["2026-02-02:111.11", "2026-03-31:95.5", "2026-06-15:150.125", "2026-09-30:160.007"].map(
      (entry, index) => {
        const [date, price] = entry.split(":");
        return { id: `p${index}`, securityId: appleId, date, sequence: 0, price, source: "provider" };
      },
    );
    const storedPrices = async (_ids: string[], upTo: string) => stored.filter((p) => p.date <= upTo);
    const chart = await depotValuation(depotId, { kind: "preset", preset: "1J" }, TODAY, db(), { storedPrices });
    expect(chart.series).toHaveLength(366);
    const dates = chart.series.filter((_, index) => index % 5 === 0 || index === chart.series.length - 1).map((p) => p.date);
    dates.push("2026-01-10", "2026-02-02", "2026-03-31", "2026-04-15", "2026-06-15", "2026-07-01", "2026-08-01", "2026-09-30");
    for (const date of dates) {
      const kpi = await depotValuation(depotId, { kind: "custom", from: chart.from, to: date }, TODAY, db(), { storedPrices });
      const end = kpi.series.at(-1)!;
      const point = chart.series.find((p) => p.date === date)!;
      expect({ date, value: point.value, investedCapital: point.investedCapital }).toEqual({
        date: end.date,
        value: end.value,
        investedCapital: end.investedCapital,
      });
    }
    // KPI Periods with a different start end on the same figures: MAX (starts on the first ledger
    // date) and a one-day Period from = to = d.
    const max = await depotValuation(depotId, { kind: "preset", preset: "MAX" }, TODAY, db(), { storedPrices });
    expect(max.from).not.toBe(chart.from);
    expect(max.series.at(-1)).toEqual(chart.series.at(-1));
    for (const date of ["2026-02-02", "2026-04-15", "2026-07-01", "2026-09-30"]) {
      const day = await depotValuation(depotId, { kind: "custom", from: date, to: date }, TODAY, db(), { storedPrices });
      expect(day.series).toHaveLength(1);
      expect(day.series[0]).toEqual(chart.series.find((p) => p.date === date));
    }
  });

  it("uses injected stored Prices up to the Period end and starts MAX on the first ledger date", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "1000" });
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", security: { id: appleId } });
    const stored: PriceObservation[] = [
      { id: "p1", securityId: appleId, date: "2026-01-12", sequence: 0, price: "110", source: "provider" },
      { id: "p2", securityId: "unrelated", date: "2026-01-12", sequence: 0, price: "1", source: "provider" },
    ];
    const storedPrices = vi.fn(async () => stored);
    const valuation = await depotValuation(depotId, { kind: "preset", preset: "MAX" }, "2026-01-13", db(), { storedPrices });
    expect(storedPrices).toHaveBeenCalledWith([appleId], "2026-01-13");
    expect(valuation.from).toBe("2026-01-05");
    expect(valuation.series.map((point) => point.value)).toEqual([
      "1000",
      "1000",
      "1000",
      "1000",
      "1000",
      "1000",
      "1000",
      "1100",
      "1100",
    ]);
  });

  it("values lots moved by an ISIN change with the new Security's prices", async () => {
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", security: { id: appleId } });
    const change = await recordIsinChange(
      {
        oldSecurityId: appleId,
        newSecurity: { new: { isin: "US5949181045", name: "Neu AG", assetType: "STOCK" } },
        date: "2026-02-01",
        oldQuantity: "10",
        newQuantity: "5",
      },
      db(),
    );
    if (!change.ok) throw new Error("setup failed");
    const newId = (await db().security.findFirstOrThrow({ where: { isin: "US5949181045" } })).id;
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-01-01", amount: "1000" });
    await book({ depotId: otherDepotId, type: "BUY", date: "2026-02-10", quantity: "1", price: "230", security: { id: newId } });

    const valuation = await depotValuation(depotId, { kind: "custom", from: "2026-01-31", to: "2026-02-10" }, TODAY, db());
    expect(valuation.series[0].positionsValue).toBe("1000");
    expect(valuation.series[1].positionsValue).toBe("1000");
    expect(valuation.series.at(-1)).toMatchObject({ positionsValue: "1150", investedCapital: "1000" });
  });

  it("is a single zero day for MAX of an empty Depot", async () => {
    const valuation = await depotValuation(depotId, { kind: "preset", preset: "MAX" }, TODAY, db());
    expect(valuation).toEqual({
      from: TODAY,
      to: TODAY,
      start: { date: "2026-10-25", value: "0", positionsValue: "0", cash: "0", investedCapital: "0" },
      series: [{ date: TODAY, value: "0", positionsValue: "0", cash: "0", investedCapital: "0" }],
      dividends: "0",
      taxesPaid: "0",
      performance: {
        gain: "0",
        realized: "0",
        unrealized: "0",
        dividends: "0",
        fees: "0",
        feesContribution: "0",
        taxesPaid: "0",
        netExternalFlows: "0",
        ttwror: null,
        xirr: null,
      },
      // Nothing invested: the index stays at its base 1.
      drawdown: { points: [{ date: TODAY, drawdown: "0" }], current: "0", max: "0", phase: null },
      performanceLine: [
        { date: "2026-10-25", performance: "0" },
        { date: TODAY, performance: "0" },
      ],
    });
  });

  it("computes the reference Period performance from one series starting the day before the Period", async () => {
    await book({ type: "DEPOSIT", date: "2021-01-01", amount: "1000" });
    await book({ type: "BUY", date: "2021-01-01", quantity: "10", price: "100", security: { id: appleId } });
    await book({ type: "DEPOSIT", date: "2022-01-01", amount: "1100" });
    await book({ type: "BUY", date: "2022-01-01", quantity: "10", price: "110", security: { id: appleId } });
    const stored: PriceObservation[] = [
      { id: "p1", securityId: appleId, date: "2021-12-31", sequence: 0, price: "110", source: "provider" },
      { id: "p2", securityId: appleId, date: "2023-01-01", sequence: 0, price: "121", source: "provider" },
    ];
    const valuation = await depotValuation(depotId, { kind: "custom", from: "2021-01-02", to: "2023-01-01" }, TODAY, db(), {
      storedPrices: async () => stored,
    });
    expect(valuation.start).toEqual({ date: "2021-01-01", value: "1000", positionsValue: "1000", cash: "0", investedCapital: "1000" });
    expect(valuation.series[0].date).toBe("2021-01-02");
    expect(valuation.series.at(-1)).toMatchObject({ date: "2023-01-01", value: "2420" });
    expect(valuation.performance).toMatchObject({ gain: "320", unrealized: "320", netExternalFlows: "1100", ttwror: "0.21" });
    expect(Math.abs(Number(valuation.performance.xirr) - 0.1)).toBeLessThan(1e-9);
  });
});

describe("valuation drawdown", () => {
  const PERIOD = { kind: "custom", from: "2026-02-01", to: "2026-02-05" } as const;
  async function decline() {
    await book({ type: "DEPOSIT", date: "2026-02-01", amount: "1000" });
    await book({ type: "BUY", date: "2026-02-01", quantity: "10", price: "100", security: { id: appleId } });
    await book({ type: "DEPOSIT", date: "2026-02-03", amount: "500" });
  }
  const stored = (): PriceObservation[] => [
    { id: "p1", securityId: appleId, date: "2026-02-02", sequence: 0, price: "90", source: "provider" },
    { id: "p2", securityId: appleId, date: "2026-02-04", sequence: 0, price: "100", source: "provider" },
  ];

  it("depotValuation: drawdown of the TTWROR index, the Deposit inside the decline is no gain", async () => {
    await decline();
    const valuation = await depotValuation(depotId, PERIOD, TODAY, db(), { storedPrices: async () => stored() });
    // Index 1, 0.9, 0.9, 0.9 · 1500 / 1400, carried: the raw value rises to 1500 but the peak (1) is not regained.
    expect(valuation.drawdown.points.map((p) => p.date)).toEqual(valuation.series.map((p) => p.date));
    expect(valuation.drawdown.points.map((p) => p.drawdown)).toEqual([
      "0",
      "-0.1",
      "-0.1",
      "-0.03571428571428571429",
      "-0.03571428571428571429",
    ]);
    expect(valuation.drawdown).toMatchObject({
      current: "-0.03571428571428571429",
      max: "-0.1",
      phase: { peak: "2026-02-01", end: "2026-02-05", recovered: false, days: 4 },
    });
    expect(valuation.performance.ttwror).toBe("-0.03571428571428571429");
  });

  it("portfolioValuation: the same drawdown when the other Depot is empty", async () => {
    await decline();
    const options = { storedPrices: async () => stored() };
    const depot = await depotValuation(depotId, PERIOD, TODAY, db(), options);
    const portfolio = await portfolioValuation(PERIOD, TODAY, db(), options);
    expect(portfolio.drawdown).toEqual(depot.drawdown);
    expect(portfolio.depots[0].valuation.drawdown).toEqual(depot.drawdown);
  });

  it("portfolioValuation: a Deposit into the second Depot during the decline is no gain (all Depots' flows count)", async () => {
    await book({ type: "DEPOSIT", date: "2026-02-01", amount: "1000" });
    await book({ type: "BUY", date: "2026-02-01", quantity: "10", price: "100", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-02-03", amount: "500" });
    const portfolio = await portfolioValuation(PERIOD, TODAY, db(), { storedPrices: async () => stored() });
    // Summed values 1000, 900, 1400 (500 deposited into Zweitdepot), 1500, 1500: index 1, 0.9, 0.9,
    // 0.9 · 1500 / 1400, carried. With Hauptdepot's rows only, 02-03 would count as a gain of 500 / 900.
    expect(portfolio.drawdown.points).toEqual([
      { date: "2026-02-01", drawdown: "0" },
      { date: "2026-02-02", drawdown: "-0.1" },
      { date: "2026-02-03", drawdown: "-0.1" },
      { date: "2026-02-04", drawdown: "-0.03571428571428571429" },
      { date: "2026-02-05", drawdown: "-0.03571428571428571429" },
    ]);
    expect(portfolio.drawdown.max).toBe("-0.1");
    expect(portfolio.drawdown.phase).toEqual({ peak: "2026-02-01", end: "2026-02-05", recovered: false, days: 4 });
    // The running peak is the index on 02-01 (= base 1), so the current drawdown is the last level − 1.
    expect(portfolio.performance.ttwror).toBe("-0.03571428571428571429");
    expect(portfolio.drawdown.current).toBe(portfolio.performance.ttwror);
  });
});

describe("valuation performance line", () => {
  const PERIOD = { kind: "custom", from: "2026-02-01", to: "2026-02-05" } as const;
  const stored = (): PriceObservation[] => [
    { id: "p1", securityId: appleId, date: "2026-02-02", sequence: 0, price: "110", source: "provider" },
  ];

  it("starts at 0 on start.date, has one point per day and ends on performance.ttwror (Depot and Portfolio)", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-20", amount: "1000" });
    await book({ type: "BUY", date: "2026-01-20", quantity: "10", price: "100", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-02-03", amount: "500" });
    const options = { storedPrices: async () => stored() };
    const depot = await depotValuation(depotId, PERIOD, TODAY, db(), options);
    // Start 1000, then 1100 on 02-02: +10 %.
    expect(depot.performanceLine).toEqual([
      { date: "2026-01-31", performance: "0" },
      { date: "2026-02-01", performance: "0" },
      { date: "2026-02-02", performance: "0.1" },
      { date: "2026-02-03", performance: "0.1" },
      { date: "2026-02-04", performance: "0.1" },
      { date: "2026-02-05", performance: "0.1" },
    ]);
    expect(depot.performanceLine.at(-1)?.performance).toBe(depot.performance.ttwror);

    const portfolio = await portfolioValuation(PERIOD, TODAY, db(), options);
    expect(portfolio.performanceLine.map((p) => p.date)).toEqual(depot.performanceLine.map((p) => p.date));
    // The Deposit into Zweitdepot is a flow (1600 / 1600), not a gain.
    expect(portfolio.performanceLine.at(-1)?.performance).toBe("0.1");
    expect(portfolio.performanceLine.at(-1)?.performance).toBe(portfolio.performance.ttwror);
    expect(portfolio.depots[0].valuation.performanceLine).toEqual(depot.performanceLine);
  });
});

describe("benchmarkLines", () => {
  it("is null for every benchmark before its Security exists", async () => {
    expect(await benchmarkLines("2026-02-06", "2026-02-09", db())).toEqual({
      "msci-world": null,
      "msci-acwi": null,
      dax: null,
      sp500: null,
    });
  });

  it("gives the price return from stored closes, based on the close on or before the start date", async () => {
    const [world, acwi] = await ensureBenchmarkSecurities(db());
    const stored: PriceObservation[] = [
      { id: "w1", securityId: world, date: "2026-02-06", sequence: 0, price: "100", source: "provider" },
      { id: "w2", securityId: world, date: "2026-02-09", sequence: 0, price: "103", source: "provider" },
      // ACWI: the first close is after the start date, so there is no base.
      { id: "a1", securityId: acwi, date: "2026-02-09", sequence: 0, price: "50", source: "provider" },
    ];
    const storedPrices = async (ids: string[], upTo: string) => stored.filter((p) => ids.includes(p.securityId) && p.date <= upTo);
    const lines = await benchmarkLines("2026-02-07", "2026-02-09", db(), { storedPrices });
    expect(lines["msci-world"]).toEqual([
      { date: "2026-02-07", performance: "0" },
      { date: "2026-02-08", performance: "0" },
      { date: "2026-02-09", performance: "0.03" },
    ]);
    expect(lines["msci-acwi"]).toBeNull();
    expect(lines.dax).toBeNull();
    expect(lines.sp500).toBeNull();
  });
});

describe("portfolioValuation", () => {
  const ONE_YEAR = { kind: "preset", preset: "1J" } as const;
  const MAX = { kind: "preset", preset: "MAX" } as const;
  const sum = (...values: string[]) => values.reduce((total, value) => total.plus(value), new ExactDecimal(0)).toFixed();

  async function twoDepots() {
    await book({ type: "DEPOSIT", date: "2025-11-01", amount: "3000" });
    await book({ type: "BUY", date: "2025-11-02", quantity: "10", price: "100", fee: "5", security: { id: appleId } });
    await book({ type: "DIVIDEND", date: "2026-03-01", amount: "50", tax: "15", security: { id: appleId } });
    await book({ type: "SELL", date: "2026-06-01", quantity: "4", price: "130", fee: "2", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-01-02", amount: "1000" });
    await book({ depotId: otherDepotId, type: "BUY", date: "2026-01-03", quantity: "5", price: "110", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "TAX", date: "2026-04-01", tax: "7.5" });
  }
  const stored: PriceObservation[] = [
    { id: "p1", securityId: "", date: "2026-02-15", sequence: 0, price: "120", source: "provider" },
    { id: "p2", securityId: "", date: "2026-09-30", sequence: 0, price: "141.25", source: "provider" },
  ];
  const storedPrices = async () => stored.map((p) => ({ ...p, securityId: appleId }));

  it("sums two Depots over one Period: series, flows and Gain/Loss split", async () => {
    await twoDepots();
    const portfolio = await portfolioValuation(ONE_YEAR, TODAY, db(), { storedPrices });
    const a = await depotValuation(depotId, ONE_YEAR, TODAY, db(), { storedPrices });
    const b = await depotValuation(otherDepotId, ONE_YEAR, TODAY, db(), { storedPrices });
    expect(portfolio.hasTransactions).toBe(true);
    expect(portfolio.depots.map((depot) => depot.name)).toEqual(["Hauptdepot", "Zweitdepot"]);
    expect(portfolio.depots[0].valuation).toEqual(a);
    expect(portfolio.depots[1].valuation).toEqual(b);
    expect({ from: portfolio.from, to: portfolio.to }).toEqual({ from: a.from, to: a.to });
    for (const [index, point] of portfolio.series.entries()) {
      const pa = a.series[index];
      const pb = b.series[index];
      expect(point).toEqual({
        date: pa.date,
        value: sum(pa.value, pb.value),
        positionsValue: sum(pa.positionsValue, pb.positionsValue),
        cash: sum(pa.cash, pb.cash),
        investedCapital: sum(pa.investedCapital, pb.investedCapital),
      });
    }
    expect(portfolio.dividends).toBe(sum(a.dividends, b.dividends));
    expect(portfolio.taxesPaid).toBe(sum(a.taxesPaid, b.taxesPaid));
    expect(portfolio.taxesPaid).toBe("22.5");
    for (const field of ["gain", "realized", "unrealized", "dividends", "fees", "taxesPaid", "netExternalFlows"] as const) {
      expect(portfolio.performance[field]).toBe(sum(a.performance[field], b.performance[field]));
    }
    expect(portfolio.performance.ttwror).not.toBeNull();
    expect(portfolio.performance.xirr).not.toBeNull();
  });

  it("evaluates every Depot from the earliest first date for MAX; a later-starting Depot keeps its own figures", async () => {
    await book({ type: "DEPOSIT", date: "2024-01-10", amount: "2000" });
    await book({ type: "BUY", date: "2024-01-10", quantity: "10", price: "100", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2025-06-01", amount: "1000" });
    await book({ depotId: otherDepotId, type: "BUY", date: "2025-06-02", quantity: "5", price: "120", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "WITHDRAWAL", date: "2026-02-01", amount: "100" });
    const portfolio = await portfolioValuation(MAX, TODAY, db(), { storedPrices });
    expect(portfolio.from).toBe("2024-01-10");
    const late = portfolio.depots.find((depot) => depot.id === otherDepotId)!.valuation;
    const own = await depotValuation(otherDepotId, MAX, TODAY, db(), { storedPrices });
    expect(own.from).toBe("2025-06-01");
    expect(late.from).toBe("2024-01-10");
    expect(late.series.at(-1)).toEqual(own.series.at(-1));
    expect(late.performance).toEqual(own.performance);
    expect(late.dividends).toBe(own.dividends);
    expect(late.taxesPaid).toBe(own.taxesPaid);
  });

  it("leaves out archived Depots and counts an empty Depot as zero", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "1000" });
    await book({ type: "BUY", date: "2026-01-06", quantity: "5", price: "100", security: { id: appleId } });
    const archived = await createDepot({ name: "Altdepot", broker: "COMDIRECT" }, db());
    if (!archived.ok) throw new Error("setup failed");
    await book({ depotId: archived.depot.id, type: "DEPOSIT", date: "2026-01-01", amount: "5000" });
    await book({ depotId: archived.depot.id, type: "WITHDRAWAL", date: "2026-01-02", amount: "5000" });
    expect((await archiveDepot(archived.depot.id, db())).ok).toBe(true);
    const portfolio = await portfolioValuation(ONE_YEAR, TODAY, db(), { storedPrices });
    expect(portfolio.depots.map((depot) => depot.name)).toEqual(["Hauptdepot", "Zweitdepot"]);
    const own = await depotValuation(depotId, ONE_YEAR, TODAY, db(), { storedPrices });
    expect(portfolio.performance).toEqual(own.performance);
    expect(portfolio.series).toEqual(own.series);
    const empty = portfolio.depots[1].valuation;
    expect(empty.series.at(-1)).toMatchObject({ value: "0" });
    expect(empty.performance).toMatchObject({ gain: "0", ttwror: null, xirr: null });
  });

  it("reports no Transactions when none of the Depots has a ledger row", async () => {
    const portfolio = await portfolioValuation(MAX, TODAY, db());
    expect(portfolio.hasTransactions).toBe(false);
    expect(portfolio.from).toBe(TODAY);
    expect(portfolio.series).toEqual([{ date: TODAY, value: "0", positionsValue: "0", cash: "0", investedCapital: "0" }]);
    expect(portfolio.depots).toHaveLength(2);
    expect(portfolio.performance).toMatchObject({ gain: "0", ttwror: null, xirr: null });
  });
});

describe("returnSeries", () => {
  const MAX = { kind: "preset", preset: "MAX" } as const;
  const storedPrices = async () => [
    { id: "p1", securityId: appleId, date: "2026-02-15", sequence: 0, price: "120", source: "provider" as const },
    { id: "p2", securityId: appleId, date: "2026-09-30", sequence: 0, price: "141.25", source: "provider" as const },
  ];

  async function setup() {
    await book({ type: "DEPOSIT", date: "2025-11-01", amount: "3000" });
    await book({ type: "BUY", date: "2025-11-02", quantity: "10", price: "100", fee: "5", security: { id: appleId } });
    await book({ type: "SELL", date: "2026-06-01", quantity: "4", price: "130", fee: "2", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-01-02", amount: "1000" });
    await book({ depotId: otherDepotId, type: "BUY", date: "2026-01-03", quantity: "5", price: "110", security: { id: appleId } });
    const archived = await createDepot({ name: "Altdepot", broker: "COMDIRECT" }, db());
    if (!archived.ok) throw new Error("setup failed");
    await book({ depotId: archived.depot.id, type: "DEPOSIT", date: "2024-01-01", amount: "5000" });
    await book({ depotId: archived.depot.id, type: "WITHDRAWAL", date: "2024-01-02", amount: "5000" });
    expect((await archiveDepot(archived.depot.id, db())).ok).toBe(true);
  }

  it("gives a Depot the MAX series of depotValuation and its rows", async () => {
    await setup();
    const result = await returnSeries({ depotId: otherDepotId }, TODAY, db(), { storedPrices });
    const valuation = await depotValuation(otherDepotId, MAX, TODAY, db(), { storedPrices });
    expect(result.start).toEqual(valuation.start);
    expect(result.series).toEqual(valuation.series);
    expect(result.rows.map((row) => row.date).sort()).toEqual(["2026-01-02", "2026-01-03"]);
  });

  it("gives the Portfolio the MAX series of portfolioValuation and the rows of every non-archived Depot", async () => {
    await setup();
    const result = await returnSeries("portfolio", TODAY, db(), { storedPrices });
    const valuation = await portfolioValuation(MAX, TODAY, db(), { storedPrices });
    expect(result.start).toEqual(valuation.start);
    expect(result.series).toEqual(valuation.series);
    expect(result.series[0].date).toBe("2025-11-01");
    expect(result.rows).toHaveLength(5);
  });

  it("feeds a heatmap whose current year equals the YTD TTWROR and whose months chain to the MAX TTWROR", async () => {
    await setup();
    const close = (a: string | null, b: string | null) => expect(new ExactDecimal(a!).minus(b!).abs().lessThan("1e-15")).toBe(true);
    for (const scope of [{ depotId }, "portfolio"] as const) {
      const { start, series, rows } = await returnSeries(scope, TODAY, db(), { storedPrices });
      const years = returnHeatmap(start, series, rows, TODAY);
      const evaluate = (preset: "YTD" | "MAX") =>
        scope === "portfolio"
          ? portfolioValuation({ kind: "preset", preset }, TODAY, db(), { storedPrices })
          : depotValuation(depotId, { kind: "preset", preset }, TODAY, db(), { storedPrices });
      close(years[0].total, (await evaluate("YTD")).performance.ttwror);
      close(chainReturns(years.flatMap((year) => year.months.map((month) => month?.return ?? null))), (await evaluate("MAX")).performance.ttwror);
    }
  });

  it("is a single zero day without rows", async () => {
    const result = await returnSeries("portfolio", TODAY, db());
    expect(result.rows).toEqual([]);
    expect(result.series).toEqual([{ date: TODAY, value: "0", positionsValue: "0", cash: "0", investedCapital: "0" }]);
  });
});

describe("valuation with a holding correction", () => {
  it("depotValuation and portfolioValuation carry the correction as a flow: gain 0", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "1000" });
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", security: { id: appleId } });
    await book({ type: "ADJUSTMENT", date: "2026-01-12", quantity: "2", price: "80", security: { id: appleId } });
    const period = { kind: "custom", from: "2026-01-11", to: "2026-01-31" } as const;

    const depot = await depotValuation(depotId, period, TODAY, db());
    const day = depot.series.find((point) => point.date === "2026-01-12");
    expect(day).toMatchObject({ value: "1200", adjustmentValue: "200", adjustmentCost: "160" });
    expect(depot.performance).toMatchObject({ gain: "0", unrealized: "0", netExternalFlows: "200", ttwror: "0" });

    const portfolio = await portfolioValuation(period, TODAY, db());
    expect(portfolio.series.find((point) => point.date === "2026-01-12")).toMatchObject({ adjustmentValue: "200", adjustmentCost: "160" });
    expect(portfolio.performance).toMatchObject({ gain: "0", ttwror: "0" });
  });
});

describe("valuationSummary", () => {
  it("takes value, invested capital and cash from the last series point, plus the Period figures", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "2000" });
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", fee: "5", security: { id: appleId } });
    await book({ type: "DIVIDEND", date: "2026-03-01", amount: "50", tax: "15", security: { id: appleId } });
    const valuation = await depotValuation(depotId, { kind: "custom", from: "2026-01-01", to: "2026-06-30" }, TODAY, db());
    const end = valuation.series.at(-1)!;
    expect(valuationSummary(valuation)).toEqual({
      from: "2026-01-01",
      to: "2026-06-30",
      value: end.value,
      investedCapital: end.investedCapital,
      cash: end.cash,
      performance: valuation.performance,
      dividends: "50",
      taxesPaid: "15",
    });
    const portfolio = await portfolioValuation({ kind: "preset", preset: "1J" }, TODAY, db());
    expect(valuationSummary(portfolio).value).toBe(portfolio.series.at(-1)!.value);
  });

  it("falls back to the start point without series days", () => {
    const start = { date: "2026-01-01", value: "10", positionsValue: "0", cash: "10", investedCapital: "0" };
    const summary = valuationSummary({ from: "2026-01-02", to: "2026-01-01", start, series: [], performance: {} as never, dividends: "0", taxesPaid: "0" });
    expect(summary).toMatchObject({ value: "10", cash: "10", investedCapital: "0" });
  });
});
