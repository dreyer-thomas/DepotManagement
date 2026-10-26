import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
/** `after()` from next/server: callbacks are captured, never run (no provider call in tests). */
const after = vi.hoisted(() => vi.fn());
/** The logo fetch that follows the price backfill in the same `after()` callback. */
const logos = vi.hoisted(() => ({ fetchMissingLogos: vi.fn() }));
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/modules/logos", () => logos);

import { prisma } from "@/db";
import { archiveDepot, createDepot, listCashBookings, listPositions, listSecurities, listTransactions, recordTransaction } from "@/modules/ledger";
import { transactionErrorMessage } from "@/app/_components/transactions/labels";
import { deleteTransactionAction, saveTransactionAction } from "./transactions";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
let depotId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
  revalidatePath.mockClear();
  after.mockClear();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ depotId, type: "BUY", date: "2026-10-01", ...fields })) data.set(key, value);
  return data;
}

const newApple = { newSecurity: "1", securityIdentifier: " us0378331005 ", securityName: "Apple Inc.", assetType: "STOCK" };

describe("saveTransactionAction", () => {
  it("books a buy with German decimals and a new Security, then revalidates", async () => {
    const result = await saveTransactionAction(null, form({ ...newApple, quantity: "10", price: "123,45", fee: "4,90", tax: "" }));
    expect(result).toMatchObject({
      ok: true,
      transaction: { type: "BUY", quantity: "10", price: "123.45", amount: "1234.5", fee: "4.9", tax: "0", sequence: 1 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    const [security] = await listSecurities();
    expect(security).toMatchObject({ isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" });
    // A price backfill, then a logo fetch, for the new Security run after the response.
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith(expect.any(Function));

    const again = await saveTransactionAction(null, form({ securityId: security.id, quantity: "1.234", price: "1.234,5" }));
    expect(again).toMatchObject({ ok: true, transaction: { quantity: "1234", price: "1234.5", sequence: 2 } });
  });

  it("keeps the booking result when scheduling the price backfill fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    after.mockImplementationOnce(() => {
      throw new Error("outside a request scope");
    });
    const result = await saveTransactionAction(null, form({ ...newApple, quantity: "10", price: "100" }));
    expect(result).toMatchObject({ ok: true, transaction: { type: "BUY" } });
    expect(await listTransactions(depotId)).toHaveLength(1);
    expect(error).toHaveBeenCalledWith("Prices: scheduling backfill failed (Error)");
    error.mockRestore();
  });

  it("books crypto from the shared identifier field", async () => {
    const result = await saveTransactionAction(
      null,
      form({ newSecurity: "1", securityIdentifier: "btc", securityName: "Bitcoin", assetType: "CRYPTO", quantity: "0,00012345", price: "60.000" }),
    );
    expect(result).toMatchObject({ ok: true, transaction: { quantity: "0.00012345", security: { cryptoSymbol: "BTC" } } });
  });

  it.each([
    [{ ...newApple, quantity: "1,2,3", price: "1" }, "quantity-invalid"],
    [{ ...newApple, quantity: "1", price: "abc" }, "price-invalid"],
    [{ ...newApple, quantity: "1", price: "1", fee: "x" }, "fee-invalid"],
    [{ ...newApple, quantity: "1", price: "1", tax: "1,2,3" }, "tax-invalid"],
    [{ ...newApple, quantity: "", price: "1" }, "quantity-invalid"],
    [{ ...newApple, securityIdentifier: "US0378331006", quantity: "1", price: "1" }, "isin-invalid"],
    [{ ...newApple, assetType: "CRYPTO", quantity: "1", price: "1" }, "asset-type-invalid"],
    [{ ...newApple, securityIdentifier: "AAPL", quantity: "1", price: "1" }, "isin-invalid"],
    [{ quantity: "1", price: "1" }, "security-required"],
    [{ securityId: "xyz", quantity: "1", price: "1" }, "security-not-found"],
  ])("returns the field error for %j without writing", async (fields, reason) => {
    expect(await saveTransactionAction(null, form(fields))).toEqual({ ok: false, reason });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toEqual([]);
    expect(await listSecurities()).toEqual([]);
  });

  it("returns the oversell with the available quantity for the message", async () => {
    await saveTransactionAction(null, form({ ...newApple, quantity: "10", price: "100" }));
    revalidatePath.mockClear();
    const [security] = await listSecurities();
    const result = await saveTransactionAction(null, form({ type: "SELL", securityId: security.id, quantity: "12", price: "110" }));
    expect(result).toEqual({ ok: false, reason: "sell-exceeds-holding", available: "10" });
    expect(result && !result.ok && transactionErrorMessage(result.reason, "available" in result ? result.available : undefined)).toBe(
      "Verkauf übersteigt Bestand (10 Stück).",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toHaveLength(1);
  });

  it("books non-trades, mapping the single Betrag field per type", async () => {
    await saveTransactionAction(null, form({ ...newApple, quantity: "1", price: "1" }));
    const [security] = await listSecurities();
    revalidatePath.mockClear();

    const deposit = await saveTransactionAction(null, form({ type: "DEPOSIT", amount: "2.000,00", quantity: "x" }));
    expect(deposit).toMatchObject({ ok: true, transaction: { type: "DEPOSIT", amount: "2000", fee: "0", tax: "0", quantity: null, security: null } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");

    expect(await saveTransactionAction(null, form({ type: "WITHDRAWAL", amount: "300" }))).toMatchObject({
      ok: true,
      transaction: { type: "WITHDRAWAL", amount: "300" },
    });
    expect(await saveTransactionAction(null, form({ type: "FEE", amount: "4,90", fee: "99" }))).toMatchObject({
      ok: true,
      transaction: { type: "FEE", amount: "0", fee: "4.9", tax: "0", security: null },
    });
    expect(await saveTransactionAction(null, form({ type: "TAX", amount: "-3,50", securityId: security.id }))).toMatchObject({
      ok: true,
      transaction: { type: "TAX", amount: "0", fee: "0", tax: "-3.5", security: { id: security.id } },
    });
    expect(await saveTransactionAction(null, form({ type: "DIVIDEND", securityId: security.id, amount: "50,00", tax: "12,50" }))).toMatchObject({
      ok: true,
      transaction: { type: "DIVIDEND", amount: "50", fee: "0", tax: "12.5", quantity: null, price: null },
    });
    expect(await listTransactions(depotId)).toHaveLength(6);
  });

  it("books a holding correction from Stück (±) and Einstandskurs; no cash effect", async () => {
    await saveTransactionAction(null, form({ ...newApple, quantity: "10", price: "100" }));
    const [security] = await listSecurities();
    const plus = await saveTransactionAction(
      null,
      form({ type: "ADJUSTMENT", securityId: security.id, quantity: "2", price: "100,00", amount: "5", fee: "1" }),
    );
    expect(plus).toMatchObject({ ok: true, transaction: { type: "ADJUSTMENT", quantity: "2", price: "100", amount: "0", fee: "0" } });
    const minus = await saveTransactionAction(null, form({ type: "ADJUSTMENT", securityId: security.id, quantity: "-1,5", price: "" }));
    expect(minus).toMatchObject({ ok: true, transaction: { quantity: "-1.5", price: null } });
    expect(await saveTransactionAction(null, form({ type: "ADJUSTMENT", securityId: security.id, quantity: "-20" }))).toEqual({
      ok: false,
      reason: "sell-exceeds-holding",
      available: "10.5",
    });
    const [position] = await listPositions(depotId, "2026-10-26");
    expect(position).toMatchObject({ quantity: "10.5" });
    expect((await listCashBookings(depotId))[0].balance).toBe("-1000");
  });

  it.each([
    [{ type: "DIVIDEND", amount: "50" }, "security-required"],
    [{ type: "DIVIDEND", ...newApple, amount: "" }, "amount-invalid"],
    [{ type: "DIVIDEND", ...newApple, amount: "5", tax: "1,2,3" }, "tax-invalid"],
    [{ type: "DEPOSIT", amount: "0" }, "amount-invalid"],
    [{ type: "DEPOSIT", amount: "abc" }, "amount-invalid"],
    [{ type: "DEPOSIT", ...newApple, amount: "5" }, "security-not-allowed"],
    [{ type: "FEE", amount: "0" }, "fee-invalid"],
    [{ type: "FEE", amount: "x" }, "fee-invalid"],
    [{ type: "TAX", amount: "0" }, "tax-invalid"],
    [{ type: "TAX", amount: "" }, "tax-invalid"],
    [{ type: "SPLIT", amount: "1" }, "type-invalid"],
  ])("rejects the non-trade %j without writing", async (fields, reason) => {
    expect(await saveTransactionAction(null, form(fields))).toEqual({ ok: false, reason });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toEqual([]);
    expect(await listSecurities()).toEqual([]);
  });

  it.each([
    ["no cookie", undefined],
    ["an invalid cookie", "garbage"],
  ])("returns unauthorized with %s and writes nothing", async (_label, cookie) => {
    fakes.current.state.incoming.clear();
    if (cookie) fakes.current.state.incoming.set(SESSION_COOKIE, cookie);
    expect(await saveTransactionAction(null, form({ ...newApple, quantity: "10", price: "1" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toEqual([]);
    expect(await listSecurities()).toEqual([]);
  });
});

describe("saveTransactionAction (edit) and deleteTransactionAction", () => {
  async function bookBuy() {
    const result = await saveTransactionAction(null, form({ ...newApple, quantity: "10", price: "100", fee: "5" }));
    if (!result?.ok) throw new Error("setup failed");
    revalidatePath.mockClear();
    after.mockClear();
    return result.transaction;
  }

  it("updates the Transaction named by transactionId and revalidates", async () => {
    const buy = await bookBuy();
    const result = await saveTransactionAction(
      null,
      form({ transactionId: buy.id, depotId: "ignored", securityId: buy.security!.id, quantity: "10", price: "90", fee: "5" }),
    );
    expect(result).toMatchObject({ ok: true, transaction: { id: buy.id, depotId, price: "90", amount: "900", sequence: 1 } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(after).toHaveBeenCalledTimes(1);
    expect(await listTransactions(depotId)).toHaveLength(1);
    expect((await listPositions(depotId, "2026-10-25"))[0].costBasis).toBe("905");
    expect((await listCashBookings(depotId))[0].cashEffect).toBe("-905");
  });

  it("returns a possible duplicate, then books it with allowDuplicate=1", async () => {
    const buy = await bookBuy();
    const fields = { securityId: buy.security!.id, quantity: "10", price: "100", fee: "5" };
    const warned = await saveTransactionAction(null, form(fields));
    expect(warned).toEqual({ ok: false, reason: "possible-duplicate", status: "duplicate", matches: [buy] });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toHaveLength(1);
    const booked = await saveTransactionAction(null, form({ ...fields, allowDuplicate: "1" }));
    expect(booked).toMatchObject({ ok: true, transaction: { sequence: 2 } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("returns transaction-not-found for an unknown id without revalidating", async () => {
    await bookBuy();
    expect(await saveTransactionAction(null, form({ transactionId: "nope", type: "DEPOSIT", amount: "5" }))).toEqual({
      ok: false,
      reason: "transaction-not-found",
    });
    expect(await deleteTransactionAction("nope")).toEqual({ ok: false, reason: "transaction-not-found" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("deletes a Transaction and revalidates", async () => {
    const buy = await bookBuy();
    expect(await deleteTransactionAction(buy.id)).toMatchObject({ ok: true, transaction: { id: buy.id } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(after).toHaveBeenCalledTimes(1);
    expect(await listTransactions(depotId)).toEqual([]);
  });

  it("rejects save, edit and delete on an archived Depot with depot-archived, without revalidating", async () => {
    const deposit = await recordTransaction({ depotId, type: "DEPOSIT", date: "2026-10-01", amount: "5" });
    const withdrawal = await recordTransaction({ depotId, type: "WITHDRAWAL", date: "2026-10-02", amount: "5" });
    if (!deposit.ok || !withdrawal.ok) throw new Error("setup failed");
    expect((await archiveDepot(depotId)).ok).toBe(true);
    revalidatePath.mockClear();
    const archived = { ok: false, reason: "depot-archived" };
    expect(await saveTransactionAction(null, form({ type: "DEPOSIT", amount: "5" }))).toEqual(archived);
    expect(await saveTransactionAction(null, form({ transactionId: deposit.transaction.id, type: "DEPOSIT", amount: "7" }))).toEqual(archived);
    expect(await deleteTransactionAction(deposit.transaction.id)).toEqual(archived);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toHaveLength(2);
    expect(transactionErrorMessage("depot-archived")).toBe("Depot ist archiviert. Bitte zuerst reaktivieren.");
  });

  it("rejects a delete that breaks a later sell, without revalidating", async () => {
    const buy = await bookBuy();
    const sell = await recordTransaction({ depotId, type: "SELL", date: "2026-10-20", quantity: "8", price: "100", security: { id: buy.security!.id } });
    expect(sell.ok).toBe(true);
    const result = await deleteTransactionAction(buy.id);
    expect(result).toEqual({ ok: false, reason: "later-sell-exceeds-holding", date: "2026-10-20" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toHaveLength(2);
  });

  it.each([
    ["no cookie", undefined],
    ["an invalid cookie", "garbage"],
  ])("returns unauthorized for edit and delete with %s and writes nothing", async (_label, cookie) => {
    const buy = await bookBuy();
    fakes.current.state.incoming.clear();
    if (cookie) fakes.current.state.incoming.set(SESSION_COOKIE, cookie);
    expect(await saveTransactionAction(null, form({ transactionId: buy.id, type: "DEPOSIT", amount: "5" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(await deleteTransactionAction(buy.id)).toEqual({ ok: false, reason: "unauthorized" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toEqual([buy]);
  });
});
