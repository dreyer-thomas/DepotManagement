import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createDepot, ensureSecurity, listPositions, recordTrade, type RecordTradeInput } from "./index";

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
