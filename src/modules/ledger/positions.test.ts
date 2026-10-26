import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createDepot, ensureSecurity, latestTradePrices, listPositions, listRealizedSales, recordIsinChange, recordTrade, type RecordTradeInput } from "./index";

let testDb: TestDatabase;
let depotId: string;
let otherDepotId: string;
let appleId: string;

const db = () => testDb.client;
const TODAY = "2026-10-25";

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

async function record(input: Partial<RecordTradeInput>) {
  const result = await recordTrade(
    { depotId, type: "BUY", date: "2026-01-10", quantity: "1", price: "1", security: { id: appleId }, ...input },
    db(),
  );
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
}

describe("listPositions", () => {
  it("is empty for a Depot without Transactions", async () => {
    expect(await listPositions(depotId, TODAY, db())).toEqual([]);
  });

  it("computes FIFO Cost Basis and values with the latest Transaction price", async () => {
    await record({ date: "2026-01-10", quantity: "10", price: "100", fee: "5" });
    await record({ date: "2026-02-10", quantity: "5", price: "120", fee: "2" });
    await record({ type: "SELL", date: "2026-03-10", quantity: "12", price: "130", fee: "3" });

    const [position, ...rest] = await listPositions(depotId, TODAY, db());
    expect(rest).toEqual([]);
    expect(position).toMatchObject({
      security: { id: appleId, name: "Apple Inc.", isin: "US0378331005", cryptoSymbol: null, assetType: "STOCK" },
      quantity: "3",
      costBasis: "361.2",
      averagePrice: "120.4",
      price: "130",
      priceDate: "2026-03-10",
      value: "390",
      gain: "28.8",
    });
    expect(position.gainRatio!.startsWith("0.0797342192")).toBe(true);
  });

  it("takes the price from another Depot and ignores Transactions after today", async () => {
    await record({ date: "2026-10-01", quantity: "2", price: "100" });
    await record({ depotId: otherDepotId, date: "2026-10-20", quantity: "1", price: "150" });
    await record({ depotId: otherDepotId, date: "2026-11-01", quantity: "1", price: "999" });
    await record({ date: "2026-10-30", quantity: "5", price: "500" });

    const [position] = await listPositions(depotId, TODAY, db());
    expect(position).toMatchObject({ quantity: "2", costBasis: "200", price: "150", priceDate: "2026-10-20", value: "300", gain: "100", gainRatio: "0.5" });
    expect(await listPositions(otherDepotId, TODAY, db())).toMatchObject([{ quantity: "1", costBasis: "150" }]);
  });

  it("leaves out fully sold Securities", async () => {
    await record({ date: "2026-10-01", quantity: "2", price: "100" });
    await record({ type: "SELL", date: "2026-10-01", quantity: "2", price: "110" });
    expect(await listPositions(depotId, TODAY, db())).toEqual([]);
  });
});

describe("latestTradePrices", () => {
  it("returns the latest BUY/SELL price per Security of any Depot on or before asOf", async () => {
    const sap = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" }, db());
    if (!sap.ok) throw new Error("setup failed");
    await record({ date: "2026-10-01", quantity: "10", price: "100" });
    await record({ depotId: otherDepotId, date: "2026-10-12", quantity: "1", price: "112" });
    await record({ date: "2026-10-10", quantity: "1", price: "110" });
    await record({ date: "2026-10-10", quantity: "1", price: "111" });
    await record({ type: "SELL", date: "2026-10-30", quantity: "1", price: "999" });
    const observations = await latestTradePrices([appleId, sap.security.id], TODAY, db());
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ securityId: appleId, date: "2026-10-12", price: "112", source: "transaction" });
    // Same date: the later sequence wins.
    expect((await latestTradePrices([appleId], "2026-10-11", db()))[0]).toMatchObject({ date: "2026-10-10", price: "111" });
    expect(await latestTradePrices([], TODAY, db())).toEqual([]);
  });
});

describe("listRealizedSales", () => {
  it("is empty without trades", async () => {
    expect(await listRealizedSales(depotId, TODAY, db())).toEqual([]);
  });

  it("lists each SELL with its FIFO gain by (date, sequence), up to asOf, across an ISIN change", async () => {
    await record({ date: "2026-01-10", quantity: "10", price: "100", fee: "5" });
    await record({ date: "2026-02-10", quantity: "5", price: "120", fee: "2" });
    await record({ type: "SELL", date: "2026-03-10", quantity: "12", price: "130", fee: "3" });
    const changed = await recordIsinChange(
      { oldSecurityId: appleId, newSecurity: { new: { isin: "DE000SYN0013", name: "Neu", assetType: "STOCK" } }, date: "2026-04-01", oldQuantity: "1", newQuantity: "2" },
      db(),
    );
    if (!changed.ok) throw new Error(changed.reason);
    const newId = changed.isinChange.newSecurity.id;
    await record({ type: "SELL", date: "2026-05-01", quantity: "6", price: "70", security: { id: newId } });
    await record({ depotId: otherDepotId, date: "2026-01-10", quantity: "1", price: "1" });
    await record({ depotId: otherDepotId, type: "SELL", date: "2026-01-11", quantity: "1", price: "2" });

    // 12 sold: 10 × 100 + 5 fee, then 2 of the 5 (2 × 120 + 2 × 2/5 fee) → cost 1245.8; proceeds 1557.
    expect(await listRealizedSales(depotId, TODAY, db())).toEqual([
      // Fees: sell fee 3 + buy fee 5 + 2/5 of buy fee 2.
      { securityId: appleId, date: "2026-03-10", sequence: 1, gain: "311.2", fees: "8.8" },
      // Remaining 3 units (cost 361.2) became 6; sold for 420. Fees: 3/5 of buy fee 2.
      { securityId: newId, date: "2026-05-01", sequence: 1, gain: "58.8", fees: "1.2" },
    ]);
    expect(await listRealizedSales(depotId, "2026-04-30", db())).toHaveLength(1);
  });
});
