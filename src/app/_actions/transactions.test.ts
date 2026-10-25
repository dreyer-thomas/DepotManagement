import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { prisma } from "@/db";
import { createDepot, listSecurities, listTransactions } from "@/modules/ledger";
import { transactionErrorMessage } from "@/app/_components/transactions/labels";
import { recordTransactionAction } from "./transactions";

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

describe("recordTransactionAction", () => {
  it("books a buy with German decimals and a new Security, then revalidates", async () => {
    const result = await recordTransactionAction(null, form({ ...newApple, quantity: "10", price: "123,45", fee: "4,90", tax: "" }));
    expect(result).toMatchObject({
      ok: true,
      transaction: { type: "BUY", quantity: "10", price: "123.45", amount: "1234.5", fee: "4.9", tax: "0", sequence: 1 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    const [security] = await listSecurities();
    expect(security).toMatchObject({ isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" });

    const again = await recordTransactionAction(null, form({ securityId: security.id, quantity: "1.234", price: "1.234,5" }));
    expect(again).toMatchObject({ ok: true, transaction: { quantity: "1234", price: "1234.5", sequence: 2 } });
  });

  it("books crypto from the shared identifier field", async () => {
    const result = await recordTransactionAction(
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
    expect(await recordTransactionAction(null, form(fields))).toEqual({ ok: false, reason });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toEqual([]);
    expect(await listSecurities()).toEqual([]);
  });

  it("returns the oversell with the available quantity for the message", async () => {
    await recordTransactionAction(null, form({ ...newApple, quantity: "10", price: "100" }));
    revalidatePath.mockClear();
    const [security] = await listSecurities();
    const result = await recordTransactionAction(null, form({ type: "SELL", securityId: security.id, quantity: "12", price: "110" }));
    expect(result).toEqual({ ok: false, reason: "sell-exceeds-holding", available: "10" });
    expect(result && !result.ok && transactionErrorMessage(result.reason, "available" in result ? result.available : undefined)).toBe(
      "Verkauf übersteigt Bestand (10 Stück).",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toHaveLength(1);
  });

  it("books non-trades, mapping the single Betrag field per type", async () => {
    await recordTransactionAction(null, form({ ...newApple, quantity: "1", price: "1" }));
    const [security] = await listSecurities();
    revalidatePath.mockClear();

    const deposit = await recordTransactionAction(null, form({ type: "DEPOSIT", amount: "2.000,00", quantity: "x" }));
    expect(deposit).toMatchObject({ ok: true, transaction: { type: "DEPOSIT", amount: "2000", fee: "0", tax: "0", quantity: null, security: null } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");

    expect(await recordTransactionAction(null, form({ type: "WITHDRAWAL", amount: "300" }))).toMatchObject({
      ok: true,
      transaction: { type: "WITHDRAWAL", amount: "300" },
    });
    expect(await recordTransactionAction(null, form({ type: "FEE", amount: "4,90", fee: "99" }))).toMatchObject({
      ok: true,
      transaction: { type: "FEE", amount: "0", fee: "4.9", tax: "0", security: null },
    });
    expect(await recordTransactionAction(null, form({ type: "TAX", amount: "-3,50", securityId: security.id }))).toMatchObject({
      ok: true,
      transaction: { type: "TAX", amount: "0", fee: "0", tax: "-3.5", security: { id: security.id } },
    });
    expect(await recordTransactionAction(null, form({ type: "DIVIDEND", securityId: security.id, amount: "50,00", tax: "12,50" }))).toMatchObject({
      ok: true,
      transaction: { type: "DIVIDEND", amount: "50", fee: "0", tax: "12.5", quantity: null, price: null },
    });
    expect(await listTransactions(depotId)).toHaveLength(6);
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
    expect(await recordTransactionAction(null, form(fields))).toEqual({ ok: false, reason });
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
    expect(await recordTransactionAction(null, form({ ...newApple, quantity: "10", price: "1" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toEqual([]);
    expect(await listSecurities()).toEqual([]);
  });
});
