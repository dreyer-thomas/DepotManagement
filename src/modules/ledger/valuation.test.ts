import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import type { PriceObservation } from "@/core/prices";
import { createDepot, depotValuation, ensureSecurity, recordIsinChange, recordTransaction, type RecordTransactionInput } from "./index";

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
