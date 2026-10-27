import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createDepot } from "@/modules/ledger";
import { exportTargetAllocations, getTargetAllocation, replaceAllTargetAllocations, setTargetAllocation } from "./index";

let testDb: TestDatabase;
const db = () => testDb.client;
const NOW = new Date("2026-10-27T10:00:00.000Z");
const now = () => NOW;

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

async function depot(name: string) {
  const result = await createDepot({ name, broker: "COMDIRECT" }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.depot.id;
}

const ZERO = {
  equityUsa: "0",
  equityEurope: "0",
  equityJapan: "0",
  equityPacificExJapan: "0",
  equityEmerging: "0",
  bonds: "0",
  commodities: "0",
  realEstate: "0",
  crypto: "0",
  cash: "0",
};

describe("target allocation", () => {
  it("stores targets per scope, reads them back and keeps a Depot's targets separate", async () => {
    const depotId = await depot("Hauptdepot");
    expect(await getTargetAllocation("portfolio", db())).toBeNull();

    expect(await setTargetAllocation("portfolio", { equityUsa: "60,5", bonds: "39.5", cash: "" }, "", db(), now)).toEqual({
      ok: true,
      allocation: { targets: { ...ZERO, equityUsa: "60.5", bonds: "39.5" }, threshold: "2" },
    });
    expect(await setTargetAllocation(depotId, { cash: "100" }, "5", db(), now)).toMatchObject({ ok: true });

    expect(await getTargetAllocation("portfolio", db())).toEqual({ targets: { ...ZERO, equityUsa: "60.5", bonds: "39.5" }, threshold: "2" });
    expect(await getTargetAllocation(depotId, db())).toEqual({ targets: { ...ZERO, cash: "100" }, threshold: "5" });
    const row = await db().targetAllocation.findUnique({ where: { scope: "portfolio" } });
    expect(row).toMatchObject({ weights: '{"equityUsa":"60.5","bonds":"39.5"}', threshold: "2", updatedAt: NOW.toISOString() });

    // Saving again replaces the scope's row.
    expect(await setTargetAllocation("portfolio", { equityEurope: "100" }, "1,5", db(), now)).toMatchObject({ ok: true });
    expect(await getTargetAllocation("portfolio", db())).toEqual({ targets: { ...ZERO, equityEurope: "100" }, threshold: "1.5" });
    expect(await db().targetAllocation.count()).toBe(2);
  });

  it("validates everything before writing", async () => {
    expect(await setTargetAllocation("portfolio", { equityUsa: "60", bonds: "39,5" }, "2", db(), now)).toEqual({ ok: false, reason: "target-sum" });
    expect(await setTargetAllocation("portfolio", { equityUsa: "-1", bonds: "101" }, "2", db(), now)).toEqual({
      ok: false,
      reason: "target-invalid",
      segment: "equityUsa",
    });
    expect(await setTargetAllocation("portfolio", { cash: "100" }, "x", db(), now)).toEqual({ ok: false, reason: "threshold-invalid" });
    expect(await setTargetAllocation("nope", { cash: "100" }, "2", db(), now)).toEqual({ ok: false, reason: "scope-not-found" });
    expect(await setTargetAllocation(42, { cash: "100" }, "2", db(), now)).toEqual({ ok: false, reason: "scope-not-found" });
    expect(await db().targetAllocation.count()).toBe(0);
  });

  it("ignores an unreadable stored row", async () => {
    await db().targetAllocation.create({ data: { scope: "portfolio", weights: "{broken", threshold: "2", updatedAt: NOW.toISOString() } });
    expect(await getTargetAllocation("portfolio", db())).toBeNull();
  });
});

describe("target allocation backup", () => {
  it("exports rows of the Portfolio and existing Depots and replaces all rows", async () => {
    const depotId = await depot("Hauptdepot");
    await setTargetAllocation("portfolio", { equityUsa: "70", bonds: "30" }, "2", db(), now);
    await setTargetAllocation(depotId, { cash: "100" }, "3", db(), now);
    await db().targetAllocation.create({ data: { scope: "deleted-depot", weights: '{"cash":"100"}', threshold: "2", updatedAt: NOW.toISOString() } });

    const exported = await exportTargetAllocations(db());
    expect(exported).toEqual(
      [
        { id: expect.any(String), scope: depotId, weights: { cash: "100" }, threshold: "3" },
        { id: expect.any(String), scope: "portfolio", weights: { equityUsa: "70", bonds: "30" }, threshold: "2" },
      ].sort((a, b) => (a.scope < b.scope ? -1 : 1)),
    );

    await replaceAllTargetAllocations(exported, db(), now);
    expect(await exportTargetAllocations(db())).toEqual(exported);
    expect(await db().targetAllocation.count()).toBe(2);

    await replaceAllTargetAllocations([], db(), now);
    expect(await db().targetAllocation.count()).toBe(0);
  });
});
