import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import type { PriceObservation } from "@/core/prices";
import { ExactDecimal } from "@/core/decimal";
import { archiveDepot, createDepot, depotValuation, ensureSecurity, portfolioValuation, recordIsinChange, recordTransaction, type RecordTransactionInput } from "./index";

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
