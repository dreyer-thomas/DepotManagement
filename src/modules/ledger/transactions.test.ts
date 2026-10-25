import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import {
  createDepot,
  ensureSecurity,
  listSecurities,
  listTransactions,
  recordTrade,
  type RecordTradeInput,
  recordTransaction,
  type RecordTransactionInput,
} from "./index";

let testDb: TestDatabase;
let depotId: string;
let appleId: string;

const db = () => testDb.client;

beforeEach(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
  const apple = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" }, db());
  if (!apple.ok) throw new Error("setup failed");
  appleId = apple.security.id;
});

afterEach(async () => {
  await testDb.cleanup();
});

function trade(overrides: Partial<RecordTradeInput> = {}): RecordTradeInput {
  return {
    depotId,
    type: "BUY",
    date: "2026-10-01",
    quantity: "10",
    price: "123.45",
    fee: "4.90",
    security: { id: appleId },
    ...overrides,
  };
}

async function record(overrides: Partial<RecordTradeInput> = {}) {
  const result = await recordTrade(trade(overrides), db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction;
}

describe("recordTrade", () => {
  it("books a buy of an existing Security in the canonical shape", async () => {
    const result = await recordTrade(trade(), db());
    expect(result).toEqual({
      ok: true,
      transaction: {
        id: expect.any(String),
        depotId,
        type: "BUY",
        date: "2026-10-01",
        sequence: 1,
        quantity: "10",
        price: "123.45",
        amount: "1234.5",
        fee: "4.9",
        tax: "0",
        security: { id: appleId, name: "Apple Inc.", isin: "US0378331005", cryptoSymbol: null, assetType: "STOCK" },
      },
    });
  });

  it("assigns the next sequence per Depot and date", async () => {
    expect((await record()).sequence).toBe(1);
    expect((await record({ type: "SELL", quantity: "1" })).sequence).toBe(2);
    expect((await record({ date: "2026-10-02" })).sequence).toBe(1);
    const other = await createDepot({ name: "ZERO", broker: "FINANZEN_ZERO" }, db());
    if (!other.ok) throw new Error("setup failed");
    expect((await record({ depotId: other.depot.id })).sequence).toBe(1);
  });

  it("keeps the amount exact and accepts a stated amount and a signed tax", async () => {
    const exact = await record({ quantity: "0.33333333", price: "3.33333333", fee: undefined });
    expect(exact.amount).toBe("1.1111110988888889");
    expect(exact.fee).toBe("0");
    const stated = await record({ amount: "1234.56", tax: "-1.50", price: "0" });
    expect(stated).toMatchObject({ amount: "1234.56", tax: "-1.5", price: "0" });
  });

  it("creates a new Security once, inside the booking", async () => {
    const security = { new: { isin: "us0378331005", name: "Apple", assetType: "STOCK" } };
    const first = await record({ security });
    expect(first.security?.id).toBe(appleId);
    const etf = { new: { isin: "IE00B4L5Y983", name: "iShares Core MSCI World", assetType: "ETF" } };
    const a = await record({ security: etf });
    const b = await record({ security: etf });
    expect(a.security?.isin).toBe("IE00B4L5Y983");
    expect(b.security?.id).toBe(a.security?.id);
    expect(await listSecurities(db())).toHaveLength(2);
  });

  it("books crypto with an exact quantity", async () => {
    const result = await record({
      quantity: "0.00012345",
      price: "60000",
      security: { new: { cryptoSymbol: "btc", name: "Bitcoin", assetType: "CRYPTO" } },
    });
    expect(result).toMatchObject({ quantity: "0.00012345", amount: "7.407" });
    expect(result.security).toMatchObject({ cryptoSymbol: "BTC", assetType: "CRYPTO" });
  });

  const newEtf = { new: { isin: "IE00B4L5Y983", name: "ETF", assetType: "ETF" } };

  it.each<[string, Partial<RecordTradeInput>, string]>([
    ["zero quantity", { quantity: "0", security: newEtf }, "quantity-invalid"],
    ["negative quantity", { quantity: "-1", security: newEtf }, "quantity-invalid"],
    ["9 decimals", { quantity: "0.123456789", security: newEtf }, "quantity-invalid"],
    ["missing quantity", { quantity: undefined, security: newEtf }, "quantity-invalid"],
    ["exponent quantity", { quantity: "1e2", security: newEtf }, "quantity-invalid"],
    ["negative price", { price: "-1", security: newEtf }, "price-invalid"],
    ["missing price", { price: "", security: newEtf }, "price-invalid"],
    ["negative fee", { fee: "-0.01", security: newEtf }, "fee-invalid"],
    ["bad tax", { tax: "abc", security: newEtf }, "tax-invalid"],
    ["negative amount", { amount: "-5", security: newEtf }, "amount-invalid"],
    ["bad type", { type: "DIVIDEND", security: newEtf }, "type-invalid"],
    ["impossible date", { date: "2026-02-30", security: newEtf }, "date-invalid"],
    ["bad ISIN check digit", { security: { new: { isin: "IE00B4L5Y984", name: "ETF", assetType: "ETF" } } }, "isin-invalid"],
    ["ISIN with CRYPTO", { security: { new: { isin: "IE00B4L5Y983", name: "ETF", assetType: "CRYPTO" } } }, "asset-type-invalid"],
    ["bad crypto symbol", { security: { new: { cryptoSymbol: "BTC/EUR", name: "B", assetType: "CRYPTO" } } }, "crypto-symbol-invalid"],
    ["empty new name", { security: { new: { isin: "IE00B4L5Y983", name: " ", assetType: "ETF" } } }, "security-name-invalid"],
    ["no Security", { security: undefined }, "security-required"],
    ["empty Security id", { security: { id: "" } }, "security-required"],
    ["unknown Security", { security: { id: "xyz" } }, "security-not-found"],
    ["unknown Depot", { depotId: "xyz", security: newEtf }, "depot-not-found"],
  ])("rejects %s and writes nothing", async (_label, overrides, reason) => {
    expect(await recordTrade(trade(overrides), db())).toEqual({ ok: false, reason });
    expect(await listTransactions(depotId, db())).toEqual([]);
    expect(await listSecurities(db())).toHaveLength(1);
  });

  it("rejects an oversell with the available quantity", async () => {
    await record();
    expect(await recordTrade(trade({ type: "SELL", quantity: "12", date: "2026-10-20" }), db())).toEqual({
      ok: false,
      reason: "sell-exceeds-holding",
      available: "10",
    });
    expect(await listTransactions(depotId, db())).toHaveLength(1);
    expect((await record({ type: "SELL", quantity: "10", date: "2026-10-20" })).type).toBe("SELL");
  });

  it("sells a held Security entered again as a new Security with its existing ISIN", async () => {
    await record();
    const sameApple = { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" as const } };
    expect(await recordTrade(trade({ type: "SELL", quantity: "12", date: "2026-10-20", security: sameApple }), db())).toEqual({
      ok: false,
      reason: "sell-exceeds-holding",
      available: "10",
    });
    const sold = await record({ type: "SELL", quantity: "5", date: "2026-10-20", security: sameApple });
    expect(sold.security?.id).toBe(appleId);
    expect(await listSecurities(db())).toHaveLength(1);
  });

  it("rejects a backdated sell that would make a later sell negative", async () => {
    await record({ date: "2026-10-01", quantity: "10" });
    await record({ type: "SELL", date: "2026-10-20", quantity: "10" });
    expect(await recordTrade(trade({ type: "SELL", date: "2026-10-10", quantity: "5" }), db())).toEqual({
      ok: false,
      reason: "sell-exceeds-holding",
      available: "0",
    });
  });

  it("counts holdings per Depot only", async () => {
    await record();
    const other = await createDepot({ name: "ZERO", broker: "FINANZEN_ZERO" }, db());
    if (!other.ok) throw new Error("setup failed");
    expect(await recordTrade(trade({ depotId: other.depot.id, type: "SELL", quantity: "1" }), db())).toEqual({
      ok: false,
      reason: "sell-exceeds-holding",
      available: "0",
    });
  });

  it("rejects a sell of a new Security without creating it", async () => {
    expect(await recordTrade(trade({ type: "SELL", quantity: "1", security: newEtf }), db())).toEqual({
      ok: false,
      reason: "sell-exceeds-holding",
      available: "0",
    });
    expect(await listSecurities(db())).toHaveLength(1);
  });

  it("rolls back a new Security when the insert fails", async () => {
    const real = db();
    const failingTx = (tx: object) => {
      const transaction = new Proxy((tx as typeof real).transaction, {
        get: (target, prop, receiver) =>
          prop === "create" ? async () => Promise.reject(new Error("insert failed")) : Reflect.get(target, prop, receiver),
      });
      return new Proxy(tx, {
        get: (target, prop, receiver) => (prop === "transaction" ? transaction : Reflect.get(target, prop, receiver)),
      });
    };
    const client = new Proxy(real, {
      get: (target, prop, receiver) =>
        prop === "$transaction"
          ? (fn: (tx: object) => Promise<unknown>) => target.$transaction((tx) => fn(failingTx(tx)))
          : Reflect.get(target, prop, receiver),
    });
    const security = { new: { isin: "IE00B4L5Y983", name: "ETF", assetType: "ETF" } };
    await expect(recordTrade(trade({ security }), client)).rejects.toThrow("insert failed");
    expect(await listSecurities(db())).toHaveLength(1);
    expect(await listTransactions(depotId, db())).toEqual([]);
  });

  it("works inside a caller's transaction", async () => {
    const result = await db().$transaction((tx) => recordTrade(trade(), tx));
    expect(result.ok).toBe(true);
    expect(await listTransactions(depotId, db())).toHaveLength(1);
  });
});

describe("recordTransaction", () => {
  const apple = () => ({ id: appleId, name: "Apple Inc.", isin: "US0378331005", cryptoSymbol: null, assetType: "STOCK" });

  async function book(input: Omit<RecordTransactionInput, "depotId">) {
    const result = await recordTransaction({ depotId, ...input }, db());
    if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
    return result.transaction;
  }

  it("books a BUY like recordTrade", async () => {
    expect(await book({ type: "BUY", date: "2026-10-01", quantity: "10", price: "100", security: { id: appleId } })).toMatchObject({
      quantity: "10",
      price: "100",
      amount: "1000",
    });
  });

  it("books a DIVIDEND with signed tax in the canonical shape, ignoring quantity and price", async () => {
    const dividend = await book({
      type: "DIVIDEND",
      date: "2026-10-01",
      amount: "50.00",
      tax: "12.50",
      quantity: "3",
      price: "1",
      security: { id: appleId },
    });
    expect(dividend).toEqual({
      id: expect.any(String),
      depotId,
      type: "DIVIDEND",
      date: "2026-10-01",
      sequence: 1,
      quantity: null,
      price: null,
      amount: "50",
      fee: "0",
      tax: "12.5",
      security: apple(),
    });
    expect((await book({ type: "DIVIDEND", date: "2026-10-02", amount: "50", tax: "-2", fee: "1", security: { id: appleId } }))).toMatchObject({
      tax: "-2",
      fee: "1",
    });
  });

  it("creates a new Security on a DIVIDEND", async () => {
    const dividend = await book({
      type: "DIVIDEND",
      date: "2026-10-01",
      amount: "20",
      security: { new: { isin: "IE00B4L5Y983", name: "iShares Core MSCI World", assetType: "ETF" } },
    });
    expect(dividend.security).toMatchObject({ isin: "IE00B4L5Y983", assetType: "ETF" });
    expect(await listSecurities(db())).toHaveLength(2);
  });

  it("books a FEE with amount 0 and an optional Security", async () => {
    expect(await book({ type: "FEE", date: "2026-10-01", fee: "4.90" })).toMatchObject({
      type: "FEE",
      quantity: null,
      price: null,
      amount: "0",
      fee: "4.9",
      tax: "0",
      security: null,
    });
    expect((await book({ type: "FEE", date: "2026-10-01", fee: "1", amount: "0", security: { id: appleId } })).security?.id).toBe(appleId);
  });

  it("books a TAX and a tax refund with amount 0", async () => {
    expect(await book({ type: "TAX", date: "2026-10-01", tax: "7" })).toMatchObject({ amount: "0", fee: "0", tax: "7", security: null });
    expect(await book({ type: "TAX", date: "2026-10-01", tax: "-3.50", security: { id: appleId } })).toMatchObject({
      tax: "-3.5",
      security: apple(),
    });
  });

  it("books DEPOSIT and WITHDRAWAL without a Security, even beyond the balance", async () => {
    expect(await book({ type: "DEPOSIT", date: "2026-10-01", amount: "2000", security: null })).toMatchObject({
      type: "DEPOSIT",
      quantity: null,
      price: null,
      amount: "2000",
      fee: "0",
      tax: "0",
      security: null,
    });
    expect(await book({ type: "WITHDRAWAL", date: "2026-10-02", amount: "5000", security: { id: "" } })).toMatchObject({
      type: "WITHDRAWAL",
      amount: "5000",
    });
  });

  it("shares the intra-day sequence with trades", async () => {
    expect((await record()).sequence).toBe(1);
    expect((await book({ type: "DEPOSIT", date: "2026-10-01", amount: "1" })).sequence).toBe(2);
    expect((await book({ type: "DIVIDEND", date: "2026-10-01", amount: "1", security: { id: appleId } })).sequence).toBe(3);
    expect((await record({ type: "SELL", quantity: "1" })).sequence).toBe(4);
  });

  const newEtf = { new: { isin: "IE00B4L5Y983", name: "ETF", assetType: "ETF" } };

  it.each<[string, Omit<RecordTransactionInput, "depotId">, string]>([
    ["DIVIDEND without Security", { type: "DIVIDEND", date: "2026-10-01", amount: "50" }, "security-required"],
    ["DIVIDEND amount 0", { type: "DIVIDEND", date: "2026-10-01", amount: "0", security: newEtf }, "amount-invalid"],
    ["DIVIDEND without amount", { type: "DIVIDEND", date: "2026-10-01", security: newEtf }, "amount-invalid"],
    ["DIVIDEND negative fee", { type: "DIVIDEND", date: "2026-10-01", amount: "5", fee: "-1", security: newEtf }, "fee-invalid"],
    ["DIVIDEND bad tax", { type: "DIVIDEND", date: "2026-10-01", amount: "5", tax: "x", security: newEtf }, "tax-invalid"],
    ["DIVIDEND bad ISIN", { type: "DIVIDEND", date: "2026-10-01", amount: "5", security: { new: { isin: "IE00B4L5Y984", name: "E", assetType: "ETF" } } }, "isin-invalid"],
    ["DEPOSIT amount 0", { type: "DEPOSIT", date: "2026-10-01", amount: "0" }, "amount-invalid"],
    ["WITHDRAWAL negative amount", { type: "WITHDRAWAL", date: "2026-10-01", amount: "-5" }, "amount-invalid"],
    ["DEPOSIT with fee", { type: "DEPOSIT", date: "2026-10-01", amount: "5", fee: "1" }, "fee-invalid"],
    ["DEPOSIT with tax", { type: "DEPOSIT", date: "2026-10-01", amount: "5", tax: "1" }, "tax-invalid"],
    ["DEPOSIT with Security", { type: "DEPOSIT", date: "2026-10-01", amount: "5", security: newEtf }, "security-not-allowed"],
    ["WITHDRAWAL with Security id", { type: "WITHDRAWAL", date: "2026-10-01", amount: "5", security: { id: "xyz" } }, "security-not-allowed"],
    ["FEE 0", { type: "FEE", date: "2026-10-01", fee: "0" }, "fee-invalid"],
    ["FEE missing", { type: "FEE", date: "2026-10-01" }, "fee-invalid"],
    ["FEE with amount", { type: "FEE", date: "2026-10-01", fee: "1", amount: "5" }, "amount-invalid"],
    ["FEE with tax", { type: "FEE", date: "2026-10-01", fee: "1", tax: "5" }, "tax-invalid"],
    ["FEE unknown Security", { type: "FEE", date: "2026-10-01", fee: "1", security: { id: "xyz" } }, "security-not-found"],
    ["TAX 0", { type: "TAX", date: "2026-10-01", tax: "0" }, "tax-invalid"],
    ["TAX missing", { type: "TAX", date: "2026-10-01" }, "tax-invalid"],
    ["TAX with fee", { type: "TAX", date: "2026-10-01", tax: "1", fee: "1" }, "fee-invalid"],
    ["unknown type", { type: "SPLIT", date: "2026-10-01", amount: "1" }, "type-invalid"],
    ["bad date", { type: "DEPOSIT", date: "2026-13-01", amount: "1" }, "date-invalid"],
  ])("rejects %s and writes nothing", async (_label, input, reason) => {
    expect(await recordTransaction({ depotId, ...input }, db())).toEqual({ ok: false, reason });
    expect(await listTransactions(depotId, db())).toEqual([]);
    expect(await listSecurities(db())).toHaveLength(1);
  });

  it("rejects an unknown Depot", async () => {
    expect(await recordTransaction({ depotId: "xyz", type: "DEPOSIT", date: "2026-10-01", amount: "1" }, db())).toEqual({
      ok: false,
      reason: "depot-not-found",
    });
  });

  it("keeps recordTrade limited to BUY and SELL", async () => {
    expect(await recordTrade({ ...trade(), type: "DEPOSIT", amount: "5", security: null }, db())).toEqual({
      ok: false,
      reason: "type-invalid",
    });
    expect(await listTransactions(depotId, db())).toEqual([]);
  });
});

describe("listTransactions", () => {
  it("lists newest first by date then sequence, with the Security", async () => {
    const a = await record({ date: "2026-09-30" });
    const b = await record({ date: "2026-10-01" });
    const c = await record({ date: "2026-10-01", type: "SELL", quantity: "1" });
    const d = await record({ date: "2026-10-15" });
    const list = await listTransactions(depotId, db());
    expect(list.map((t) => t.id)).toEqual([d.id, c.id, b.id, a.id]);
    expect(list[0].security?.name).toBe("Apple Inc.");
  });

  it("returns only the given Depot's Transactions", async () => {
    await record();
    expect(await listTransactions("other", db())).toEqual([]);
  });
});
