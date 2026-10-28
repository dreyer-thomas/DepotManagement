import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { gainsAnalysis } from "@/core/gains-analysis";
import { archiveDepot, createDepot, depotValuation, dividendAnalysisInput, ensureSecurity, gainsInput, listPositions, recordSplit, recordTransaction, type RecordTransactionInput, taxLedgerInput } from "./index";

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

describe("gainsInput", () => {
  it("loads one Depot's rows, the corporate actions and the Security names", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-10", amount: "2000" });
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", fee: "1", security: { id: appleId } });
    await book({ type: "SELL", date: "2026-03-05", quantity: "4", price: "120", fee: "2", tax: "5", security: { id: appleId } });
    await book({ type: "DIVIDEND", date: "2026-03-20", amount: "30", fee: "0.5", tax: "7.5", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-01-01", amount: "99" });
    expect((await recordSplit({ securityId: appleId, date: "2026-06-01", ratio: "1:2" }, db())).ok).toBe(true);

    const input = await gainsInput({ depotId }, db());
    expect(input.depots.map((depot) => [depot.depotId, depot.rows.length])).toEqual([[depotId, 4]]);
    expect(input.depots[0].rows.find((row) => row.type === "SELL")).toMatchObject({ quantity: "4", amount: "480", fee: "2", tax: "5", price: "120" });
    expect(input.actions.splits).toHaveLength(1);
    expect(input.securityNames).toEqual({ [appleId]: "Apple Inc." });

    // The year's figures equal the Depot's Period figures for the same calendar year.
    const analysis = gainsAnalysis(input.depots, input.actions, TODAY);
    const valuation = await depotValuation(depotId, { kind: "custom", from: "2026-01-01", to: "2026-12-31" }, TODAY, db());
    const [year] = analysis.years;
    expect(year).toMatchObject({ period: "2026", realized: valuation.performance.realized, dividends: valuation.dividends, fees: valuation.performance.fees, taxes: valuation.taxesPaid });
    expect(year).toMatchObject({ realized: "77.6", dividends: "30", fees: "0.5", taxes: "12.5", deposits: "2000" });
    expect(analysis.sales[0]).toMatchObject({ depotId, securityId: appleId, quantity: "4", gain: "77.6" });
  });

  it("reads the non-archived Depots for the Portfolio", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "1000" });
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-02-01", amount: "50" });
    const archived = await createDepot({ name: "Altdepot", broker: "COMDIRECT" }, db());
    if (!archived.ok) throw new Error("setup failed");
    await book({ depotId: archived.depot.id, type: "DEPOSIT", date: "2026-01-01", amount: "5000" });
    await book({ depotId: archived.depot.id, type: "WITHDRAWAL", date: "2026-01-02", amount: "5000" });
    expect((await archiveDepot(archived.depot.id, db())).ok).toBe(true);

    const input = await gainsInput("portfolio", db());
    expect(input.depots.map((depot) => depot.depotId).sort()).toEqual([depotId, otherDepotId].sort());
    const { years } = gainsAnalysis(input.depots, input.actions, TODAY);
    expect(years).toEqual([
      { period: "2026", realized: "0", dividends: "0", fees: "0", taxes: "0", deposits: "1050", withdrawals: "0", netCashFlow: "1050" },
    ]);
  });
});

describe("taxLedgerInput", () => {
  it("reads every Depot with its broker, archived ones included", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "1000" });
    const archived = await createDepot({ name: "Altdepot", broker: "DEUTSCHE_BANK" }, db());
    if (!archived.ok) throw new Error("setup failed");
    await book({ depotId: archived.depot.id, type: "DEPOSIT", date: "2025-01-01", amount: "5000" });
    await book({ depotId: archived.depot.id, type: "WITHDRAWAL", date: "2025-01-02", amount: "5000" });
    expect((await archiveDepot(archived.depot.id, db())).ok).toBe(true);

    const input = await taxLedgerInput(db());
    const summary = input.depots.map((depot) => [depot.depotId, depot.broker, depot.rows.length]);
    expect(summary).toHaveLength(3);
    expect(summary).toEqual(
      expect.arrayContaining([
        [depotId, "COMDIRECT", 1],
        [otherDepotId, "FINANZEN_ZERO", 0],
        [archived.depot.id, "DEUTSCHE_BANK", 2],
      ]),
    );
    expect(input.actions).toEqual({ splits: [], isinChanges: [] });
  });
});

describe("dividendAnalysisInput", () => {
  it("adds each Depot's Positions as of today to the scope's gains input", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-10", amount: "2000" });
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", fee: "1", security: { id: appleId } });
    await book({ type: "DIVIDEND", date: "2026-03-20", amount: "30", tax: "7.5", security: { id: appleId } });
    await book({ depotId: otherDepotId, type: "DEPOSIT", date: "2026-01-01", amount: "99" });
    const storedPrices = async (ids: string[]) => ids.map((securityId) => ({ id: "p", securityId, date: "2026-10-20", sequence: 0, price: "150", source: "provider" as const }));

    const input = await dividendAnalysisInput("portfolio", TODAY, db(), { storedPrices });
    const gains = await gainsInput("portfolio", db());
    expect(input.actions).toEqual(gains.actions);
    expect(input.securityNames).toEqual(gains.securityNames);
    const positions = await listPositions(depotId, TODAY, db(), { storedPrices });
    expect(positions[0].value).toBe("1500");
    expect(input.depots).toEqual(
      gains.depots.map((depot) => ({
        ...depot,
        positions:
          depot.depotId === depotId
            ? [{ securityId: appleId, quantity: "10", value: "1500", costBasis: positions[0].costBasis }]
            : [],
      })),
    );
    const one = await dividendAnalysisInput({ depotId: otherDepotId }, TODAY, db());
    expect(one.depots).toEqual([{ depotId: otherDepotId, rows: expect.any(Array), positions: [] }]);
  });
});
