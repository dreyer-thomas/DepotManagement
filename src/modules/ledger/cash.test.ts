import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createDepot, listCashBookings, recordTransaction, type RecordTransactionInput } from "./index";

let testDb: TestDatabase;
let depotId: string;

const db = () => testDb.client;

beforeEach(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
});

afterEach(async () => {
  await testDb.cleanup();
});

async function book(input: Omit<RecordTransactionInput, "depotId">, target = depotId) {
  const result = await recordTransaction({ depotId: target, ...input }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction;
}

describe("listCashBookings", () => {
  it("is empty without Transactions", async () => {
    expect(await listCashBookings(depotId, db())).toEqual([]);
  });

  it("lists bookings newest first with cash effect and running balance", async () => {
    const security = { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } };
    await book({ type: "FEE", date: "2026-03-02", fee: "4.9" });
    const deposit = await book({ type: "DEPOSIT", date: "2026-01-05", amount: "2000" });
    await book({ type: "WITHDRAWAL", date: "2026-03-04", amount: "300" });
    const dividend = await book({ type: "DIVIDEND", date: "2026-03-01", amount: "50", tax: "12.5", security });
    await book({ type: "TAX", date: "2026-03-03", tax: "-3.5" });
    await book({ type: "BUY", date: "2026-01-10", quantity: "10", price: "100", fee: "5", security });
    await book({ type: "DEPOSIT", date: "2099-01-01", amount: "100" });
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "1" }, (await createOther()).id);

    const bookings = await listCashBookings(depotId, db());
    expect(bookings.map((b) => [b.type, b.date, b.cashEffect, b.balance])).toEqual([
      ["DEPOSIT", "2099-01-01", "100", "831.1"],
      ["WITHDRAWAL", "2026-03-04", "-300", "731.1"],
      ["TAX", "2026-03-03", "3.5", "1031.1"],
      ["FEE", "2026-03-02", "-4.9", "1027.6"],
      ["DIVIDEND", "2026-03-01", "37.5", "1032.5"],
      ["BUY", "2026-01-10", "-1005", "995"],
      ["DEPOSIT", "2026-01-05", "2000", "2000"],
    ]);
    expect(bookings.at(-1)).toEqual({
      id: deposit.id,
      type: "DEPOSIT",
      date: "2026-01-05",
      sequence: 1,
      security: null,
      cashEffect: "2000",
      balance: "2000",
    });
    expect(bookings[4].id).toBe(dividend.id);
    expect(bookings[4].security).toMatchObject({ name: "Apple Inc.", isin: "US0378331005" });
  });

  it("orders by sequence within a date", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "10" });
    await book({ type: "WITHDRAWAL", date: "2026-01-05", amount: "30" });
    expect((await listCashBookings(depotId, db())).map((b) => [b.sequence, b.balance])).toEqual([
      [2, "-20"],
      [1, "10"],
    ]);
  });
});

async function createOther() {
  const other = await createDepot({ name: "Zweitdepot", broker: "FINANZEN_ZERO" }, db());
  if (!other.ok) throw new Error("setup failed");
  return other.depot;
}
