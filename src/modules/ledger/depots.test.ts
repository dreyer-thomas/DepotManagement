import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createDepot, getDepot, listDepots, renameDepot } from "./index";

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
