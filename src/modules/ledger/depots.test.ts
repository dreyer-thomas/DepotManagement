import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import {
  archiveDepot,
  createDepot,
  deleteDepot,
  deleteTransaction,
  ensureSecurity,
  getDepot,
  listDepots,
  listHeldSecurities,
  listSplits,
  recordSplit,
  recordTransaction,
  type RecordTransactionInput,
  renameDepot,
  unarchiveDepot,
  updateTransaction,
} from "./index";

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
      depot: {
        id: expect.any(String),
        name: "Comdirect Depot",
        broker: "COMDIRECT",
        cashBalance: "0",
        archived: false,
        archivable: true,
        transactionCount: 0,
      },
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

describe("archiveDepot / unarchiveDepot", () => {
  async function book(depotId: string, input: Omit<RecordTransactionInput, "depotId">) {
    const result = await recordTransaction({ depotId, ...input }, db());
    if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
    return result.transaction;
  }

  async function security(isin = "US0378331005", name = "Apple Inc.") {
    const result = await ensureSecurity({ isin }, { name, assetType: "STOCK" }, db());
    if (!result.ok) throw new Error("setup failed");
    return result.security.id;
  }

  it("archives an empty Depot and lists it as archived", async () => {
    const depot = await create("Hauptdepot");
    expect(depot).toMatchObject({ archived: false, archivable: true });
    expect(await archiveDepot(depot.id, db())).toEqual({ ok: true, depot: { ...depot, archived: true } });
    expect(await listDepots(db())).toEqual([{ ...depot, archived: true }]);
  });

  it("archives a flat Depot", async () => {
    const depot = await create("Hauptdepot");
    const id = await security();
    await book(depot.id, { type: "DEPOSIT", date: "2026-01-01", amount: "1000" });
    await book(depot.id, { type: "BUY", date: "2026-01-02", quantity: "10", price: "100", security: { id } });
    await book(depot.id, { type: "SELL", date: "2026-01-03", quantity: "10", price: "100", security: { id } });
    await book(depot.id, { type: "WITHDRAWAL", date: "2026-01-04", amount: "1000" });
    expect((await getDepot(depot.id, db()))?.archivable).toBe(true);
    expect((await archiveDepot(depot.id, db())).ok).toBe(true);
    expect((await getDepot(depot.id, db()))?.archived).toBe(true);
  });

  it.each<[string, string, (depotId: string, securityId: string) => Promise<void>]>([
    [
      "a sub-cent residual from unrounded trade amounts",
      "0.0043",
      async (depotId, id) => {
        await book(depotId, { type: "DEPOSIT", date: "2026-01-01", amount: "200" });
        await book(depotId, { type: "BUY", date: "2026-01-02", quantity: "3.412871", price: "43.95", security: { id } });
        await book(depotId, { type: "SELL", date: "2026-01-03", quantity: "3.412871", price: "43.95", security: { id } });
        await book(depotId, { type: "WITHDRAWAL", date: "2026-01-04", amount: "199.9957" });
      },
    ],
    [
      "a negative sub-cent residual",
      "-0.0043",
      async (depotId) => {
        await book(depotId, { type: "DEPOSIT", date: "2026-01-01", amount: "1" });
        await book(depotId, { type: "WITHDRAWAL", date: "2026-01-02", amount: "1.0043" });
      },
    ],
  ])("archives a Depot with %s and keeps the remainder", async (_label, residual, setup) => {
    const depot = await create("Hauptdepot");
    await setup(depot.id, await security());
    const before = await db().transaction.findMany({ orderBy: { id: "asc" } });
    expect(await getDepot(depot.id, db())).toMatchObject({ cashBalance: residual, archivable: true });
    expect(await archiveDepot(depot.id, db())).toMatchObject({ ok: true, depot: { archived: true, cashBalance: residual } });
    expect(await db().transaction.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it.each<[string, (depotId: string, securityId: string) => Promise<void>]>([
    [
      "an open Position",
      async (depotId, id) => {
        await book(depotId, { type: "DEPOSIT", date: "2026-01-01", amount: "1000" });
        await book(depotId, { type: "BUY", date: "2026-01-02", quantity: "10", price: "100", security: { id } });
      },
    ],
    ["cash left", async (depotId) => void (await book(depotId, { type: "DEPOSIT", date: "2026-01-01", amount: "0.01" }))],
    ["half a cent of cash", async (depotId) => void (await book(depotId, { type: "DEPOSIT", date: "2026-01-01", amount: "0.005" }))],
    ["minus half a cent of cash", async (depotId) => void (await book(depotId, { type: "WITHDRAWAL", date: "2026-01-01", amount: "0.005" }))],
    [
      "a sub-unit quantity left",
      async (depotId, id) => {
        await book(depotId, { type: "BUY", date: "2026-01-02", quantity: "1", price: "0", security: { id } });
        await book(depotId, { type: "SELL", date: "2026-01-03", quantity: "0.99999999", price: "0", security: { id } });
      },
    ],
    [
      "a future-dated Position",
      async (depotId, id) => {
        await book(depotId, { type: "DEPOSIT", date: "2099-01-01", amount: "100" });
        await book(depotId, { type: "BUY", date: "2099-01-02", quantity: "1", price: "100", security: { id } });
      },
    ],
  ])("refuses a Depot with %s", async (_label, setup) => {
    const depot = await create("Hauptdepot");
    await setup(depot.id, await security());
    expect((await getDepot(depot.id, db()))?.archivable).toBe(false);
    expect(await archiveDepot(depot.id, db())).toEqual({ ok: false, reason: "depot-not-flat" });
    expect((await getDepot(depot.id, db()))?.archived).toBe(false);
  });

  it("rejects every write to an archived Depot and writes nothing", async () => {
    const depot = await create("Hauptdepot");
    const row = await book(depot.id, { type: "DEPOSIT", date: "2026-01-01", amount: "100" });
    await book(depot.id, { type: "WITHDRAWAL", date: "2026-01-02", amount: "100" });
    expect((await archiveDepot(depot.id, db())).ok).toBe(true);
    const before = await db().transaction.findMany({ orderBy: { id: "asc" } });

    expect(await recordTransaction({ depotId: depot.id, type: "DEPOSIT", date: "2026-01-03", amount: "5" }, db())).toEqual({
      ok: false,
      reason: "depot-archived",
    });
    expect(
      await updateTransaction(row.id, { depotId: depot.id, type: "DEPOSIT", date: "2026-01-01", amount: "200" }, db()),
    ).toEqual({ ok: false, reason: "depot-archived" });
    expect(await deleteTransaction(row.id, db())).toEqual({ ok: false, reason: "depot-archived" });
    expect(await renameDepot(depot.id, { name: "Neu" }, db())).toEqual({ ok: false, reason: "depot-archived" });

    expect(await db().transaction.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect((await getDepot(depot.id, db()))?.name).toBe("Hauptdepot");
  });

  it("still validates before the archive check", async () => {
    const depot = await create("Hauptdepot");
    expect((await archiveDepot(depot.id, db())).ok).toBe(true);
    expect(await renameDepot(depot.id, { name: "  " }, db())).toEqual({ ok: false, reason: "name-empty" });
    expect(await recordTransaction({ depotId: depot.id, type: "DEPOSIT", date: "nope", amount: "5" }, db())).toEqual({
      ok: false,
      reason: "date-invalid",
    });
  });

  it("unarchives so the Depot can be booked again", async () => {
    const depot = await create("Hauptdepot");
    await archiveDepot(depot.id, db());
    expect(await unarchiveDepot(depot.id, db())).toEqual({ ok: true, depot });
    expect((await recordTransaction({ depotId: depot.id, type: "DEPOSIT", date: "2026-01-01", amount: "5" }, db())).ok).toBe(true);
    expect(await unarchiveDepot(depot.id, db())).toMatchObject({ ok: true, depot: { archived: false } });
  });

  it("is idempotent on an already archived Depot", async () => {
    const depot = await create("Hauptdepot");
    await archiveDepot(depot.id, db());
    expect(await archiveDepot(depot.id, db())).toEqual({ ok: true, depot: { ...depot, archived: true } });
  });

  it("reports an unknown id as not-found", async () => {
    expect(await archiveDepot("nope", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await unarchiveDepot("nope", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await listDepots(db())).toEqual([]);
  });

  it("lists held Securities of non-archived Depots as of today", async () => {
    const a = await create("A");
    const b = await create("B");
    const c = await create("C");
    const s1 = await security("US0378331005", "S1");
    const s2 = await security("DE0007164600", "S2");
    const s3 = await security("DE0005557508", "S3");
    const s4 = await security("DE0007100000", "S4");
    await book(a.id, { type: "BUY", date: "2026-01-01", quantity: "5", price: "0", security: { id: s1 } });
    await book(b.id, { type: "BUY", date: "2026-01-01", quantity: "5", price: "0", security: { id: s2 } });
    await book(a.id, { type: "BUY", date: "2026-01-01", quantity: "2", price: "0", security: { id: s3 } });
    await book(a.id, { type: "SELL", date: "2026-01-02", quantity: "2", price: "0", security: { id: s3 } });
    await book(a.id, { type: "BUY", date: "2099-01-01", quantity: "1", price: "0", security: { id: s4 } });
    await book(c.id, { type: "BUY", date: "2026-01-01", quantity: "5", price: "0", security: { id: s1 } });
    await book(c.id, { type: "SELL", date: "2026-01-02", quantity: "5", price: "0", security: { id: s1 } });
    // B holds s2, so it cannot be archived through the service; archive it directly for the held-set check.
    await db().depot.update({ where: { id: b.id }, data: { archived: true } });
    expect(await listHeldSecurities("2026-10-25", db())).toEqual([s1]);
  });
});

describe("deleteDepot", () => {
  async function book(depotId: string, input: Omit<RecordTransactionInput, "depotId">) {
    const result = await recordTransaction({ depotId, ...input }, db());
    if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  }

  it("deletes only the Depot and its Transactions; shared Securities, their splits and other Depots stay", async () => {
    const target = await create("Ziel");
    const other = await create("Anderes");
    const shared = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" }, db());
    if (!shared.ok) throw new Error("setup failed");
    const id = shared.security.id;
    const split = await recordSplit({ securityId: id, date: "2026-02-01", ratio: "1:4" }, db());
    if (!split.ok) throw new Error("setup failed");
    await book(target.id, { type: "DEPOSIT", date: "2026-01-01", amount: "5000" });
    await book(target.id, { type: "BUY", date: "2026-01-02", quantity: "10", price: "100", security: { id } });
    await book(target.id, { type: "DIVIDEND", date: "2026-01-03", amount: "5", security: { id } });
    await book(target.id, { type: "FEE", date: "2026-01-04", fee: "1" });
    await book(target.id, { type: "TAX", date: "2026-01-05", tax: "1" });
    await book(target.id, { type: "SELL", date: "2026-03-01", quantity: "4", price: "30", security: { id } });
    await book(target.id, { type: "WITHDRAWAL", date: "2026-03-02", amount: "10" });
    await book(other.id, { type: "DEPOSIT", date: "2026-01-01", amount: "1000" });
    await book(other.id, { type: "BUY", date: "2026-01-02", quantity: "1", price: "100", security: { id } });
    expect((await getDepot(target.id, db()))?.transactionCount).toBe(7);

    expect(await deleteDepot(target.id, db())).toEqual({ ok: true, deleted: { transactions: 7 } });
    expect(await getDepot(target.id, db())).toBeNull();
    expect(await db().transaction.count({ where: { depotId: target.id } })).toBe(0);
    expect(await listDepots(db())).toEqual([expect.objectContaining({ id: other.id, transactionCount: 2 })]);
    expect(await db().security.count()).toBe(1);
    expect(await listSplits(db())).toEqual([expect.objectContaining({ security: expect.objectContaining({ id }), date: "2026-02-01" })]);
  });

  it("deletes an archived Depot and reports an unknown id as not-found", async () => {
    const depot = await create("Archiv");
    expect((await archiveDepot(depot.id, db())).ok).toBe(true);
    expect(await deleteDepot(depot.id, db())).toEqual({ ok: true, deleted: { transactions: 0 } });
    expect(await listDepots(db())).toEqual([]);
    expect(await deleteDepot(depot.id, db())).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("listHeldSecurities with holding corrections", () => {
  it("drops a Security corrected to 0 and includes one held only via a positive ADJUSTMENT", async () => {
    const depot = await create("A");
    const ids: string[] = [];
    for (const [isin, name] of [["DE000SYNCA09", "Synthetic Alpha AG"], ["DE000SYNCB08", "Synthetic Beta AG"]]) {
      const result = await ensureSecurity({ isin }, { name, assetType: "STOCK" }, db());
      if (!result.ok) throw new Error("setup failed");
      ids.push(result.security.id);
    }
    const [alpha, beta] = ids;
    const book = async (input: Omit<RecordTransactionInput, "depotId">) => {
      const result = await recordTransaction({ depotId: depot.id, ...input }, db());
      if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
    };
    await book({ type: "BUY", date: "2026-01-01", quantity: "5", price: "10", security: { id: alpha } });
    await book({ type: "ADJUSTMENT", date: "2026-02-01", quantity: "-5", security: { id: alpha } });
    await book({ type: "ADJUSTMENT", date: "2026-02-01", quantity: "3", price: "10", security: { id: beta } });
    expect(await listHeldSecurities("2026-10-25", db())).toEqual([beta]);
  });
});
