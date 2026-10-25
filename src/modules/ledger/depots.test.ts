import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createDepot, getDepot, listDepots, recordTransaction, type RecordTransactionInput, renameDepot } from "./index";

let testDb: TestDatabase;

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

const db = () => testDb.client;

async function create(name: string, broker: unknown = "COMDIRECT") {
  const result = await createDepot({ name, broker }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.depot;
}

describe("createDepot", () => {
  it("stores the trimmed name and lists it with a zero cash balance", async () => {
    const result = await createDepot({ name: "  Comdirect Depot ", broker: "COMDIRECT" }, db());
    expect(result).toEqual({
      ok: true,
      depot: { id: expect.any(String), name: "Comdirect Depot", broker: "COMDIRECT", cashBalance: "0" },
    });
    expect(await listDepots(db())).toEqual([result.ok && result.depot]);
  });

  it.each([
    ["empty", "   ", "name-empty"],
    ["missing", undefined, "name-empty"],
    ["61 characters", "x".repeat(61), "name-too-long"],
  ])("rejects a %s name", async (_label, name, reason) => {
    expect(await createDepot({ name, broker: "COMDIRECT" }, db())).toEqual({ ok: false, reason });
    expect(await listDepots(db())).toEqual([]);
  });

  it("accepts exactly 60 characters", async () => {
    expect((await createDepot({ name: "x".repeat(60), broker: "FINANZEN_ZERO" }, db())).ok).toBe(true);
  });

  it("rejects a name that differs only in case", async () => {
    await create("Comdirect Depot");
    expect(await createDepot({ name: "comdirect depot", broker: "DEUTSCHE_BANK" }, db())).toEqual({
      ok: false,
      reason: "name-taken",
    });
    expect(await listDepots(db())).toHaveLength(1);
  });

  it("rejects an NFD duplicate of an NFC name and stores names as NFC", async () => {
    const nfc = "\u00d6ko";
    const nfd = "O\u0308ko";
    expect(nfc).not.toBe(nfd);
    const first = await create(nfd);
    expect(first.name).toBe(nfc);
    expect(await createDepot({ name: nfc, broker: "COMDIRECT" }, db())).toEqual({ ok: false, reason: "name-taken" });
    expect(await listDepots(db())).toHaveLength(1);
  });

  it.each(["FOO", undefined, "", "comdirect"])("rejects the broker %j", async (broker) => {
    expect(await createDepot({ name: "Depot", broker }, db())).toEqual({ ok: false, reason: "broker-invalid" });
    expect(await listDepots(db())).toEqual([]);
  });
});

describe("renameDepot", () => {
  it("renames a Depot", async () => {
    const depot = await create("Comdirect Depot");
    expect(await renameDepot(depot.id, { name: " Hauptdepot " }, db())).toEqual({
      ok: true,
      depot: { ...depot, name: "Hauptdepot" },
    });
    expect(await getDepot(depot.id, db())).toEqual({ ...depot, name: "Hauptdepot" });
  });

  it("allows its own name in another case", async () => {
    const depot = await create("Hauptdepot");
    const result = await renameDepot(depot.id, { name: "HAUPTDEPOT" }, db());
    expect(result).toEqual({ ok: true, depot: { ...depot, name: "HAUPTDEPOT" } });
  });

  it("rejects another Depot's name, ignoring case", async () => {
    const depot = await create("Hauptdepot");
    await create("ZERO", "FINANZEN_ZERO");
    expect(await renameDepot(depot.id, { name: "zero" }, db())).toEqual({ ok: false, reason: "name-taken" });
    expect(await getDepot(depot.id, db())).toEqual(depot);
  });

  it.each([
    ["   ", "name-empty"],
    ["y".repeat(61), "name-too-long"],
  ])("rejects the name %j", async (name, reason) => {
    const depot = await create("Hauptdepot");
    expect(await renameDepot(depot.id, { name }, db())).toEqual({ ok: false, reason });
    expect(await getDepot(depot.id, db())).toEqual(depot);
  });

  it("reports an unknown id as not-found", async () => {
    expect(await renameDepot("xyz", { name: "Neu" }, db())).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("listDepots and getDepot", () => {
  it("sorts by name with German collation", async () => {
    await create("Zero");
    await create("Öko");
    await create("alpha");
    await create("Bank");
    expect((await listDepots(db())).map((depot) => depot.name)).toEqual(["alpha", "Bank", "Öko", "Zero"]);
  });

  it("returns null for an unknown id", async () => {
    expect(await getDepot("xyz", db())).toBeNull();
  });
});

describe("cash balance", () => {
  async function book(depotId: string, input: Omit<RecordTransactionInput, "depotId">) {
    const result = await recordTransaction({ depotId, ...input }, db());
    if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  }

  async function bookMatrix(depotId: string) {
    const security = { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } };
    await book(depotId, { type: "WITHDRAWAL", date: "2026-03-04", amount: "300" });
    await book(depotId, { type: "DIVIDEND", date: "2026-03-01", amount: "50", tax: "12.5", security });
    await book(depotId, { type: "DEPOSIT", date: "2026-01-05", amount: "2000" });
    await book(depotId, { type: "TAX", date: "2026-03-03", tax: "-3.5" });
    await book(depotId, { type: "BUY", date: "2026-01-10", quantity: "10", price: "100", fee: "5", security });
    await book(depotId, { type: "FEE", date: "2026-03-02", fee: "4.9" });
  }

  it("is computed from the Depot's Transactions, excluding future-dated ones", async () => {
    const depot = await create("Hauptdepot");
    await bookMatrix(depot.id);
    await book(depot.id, { type: "DEPOSIT", date: "2099-01-01", amount: "100" });
    expect((await getDepot(depot.id, db()))?.cashBalance).toBe("731.1");
    const renamed = await renameDepot(depot.id, { name: "Neu" }, db());
    expect(renamed.ok && renamed.depot.cashBalance).toBe("731.1");
  });

  it("lists each Depot with its own balance, including negative ones", async () => {
    const a = await create("A");
    const b = await create("B");
    await create("C");
    await bookMatrix(a.id);
    await book(b.id, { type: "WITHDRAWAL", date: "2026-01-01", amount: "25.5" });
    expect((await listDepots(db())).map((depot) => [depot.name, depot.cashBalance])).toEqual([
      ["A", "731.1"],
      ["B", "-25.5"],
      ["C", "0"],
    ]);
  });
});

describe("unique-constraint backstop", () => {
  // Simulates the read-then-write race: the case-insensitive pre-check sees no Depots,
  // so only the DB unique index catches the duplicate (Prisma P2002).
  function raceDb() {
    const real = db();
    const depot = new Proxy(real.depot, {
      get: (target, prop, receiver) =>
        prop === "findMany" ? async () => [] : Reflect.get(target, prop, receiver),
    });
    return new Proxy(real, {
      get: (target, prop, receiver) => (prop === "depot" ? depot : Reflect.get(target, prop, receiver)),
    });
  }

  it("maps P2002 on create to name-taken", async () => {
    await create("Hauptdepot");
    expect(await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, raceDb())).toEqual({
      ok: false,
      reason: "name-taken",
    });
  });

  it("maps P2002 on rename to name-taken", async () => {
    await create("Hauptdepot");
    const other = await create("ZERO");
    expect(await renameDepot(other.id, { name: "Hauptdepot" }, raceDb())).toEqual({
      ok: false,
      reason: "name-taken",
    });
  });
});
