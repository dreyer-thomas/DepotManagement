import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import {
  archiveDepot,
  createDepot,
  deleteSplit,
  ensureSecurity,
  getDepot,
  listDepots,
  listHeldSecurities,
  listPositions,
  listSplits,
  recordSplit,
  recordTrade,
  type RecordTradeInput,
  updateSplit,
  updateTransaction,
} from "./index";

let testDb: TestDatabase;
let depotId: string;
let otherDepotId: string;
let appleId: string;

const db = () => testDb.client;

beforeEach(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
  const other = await createDepot({ name: "Zweitdepot", broker: "DEUTSCHE_BANK" }, db());
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

async function trade(overrides: Partial<RecordTradeInput> = {}) {
  const result = await recordTrade(
    { depotId, type: "BUY", date: "2024-01-02", quantity: "10", price: "400", security: { id: appleId }, ...overrides },
    db(),
  );
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction;
}

async function split(date = "2024-03-01", ratio = "1:4") {
  const result = await recordSplit({ securityId: appleId, date, ratio }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.split;
}

describe("recordSplit", () => {
  it("stores one CorporateAction without touching Transactions and adjusts Positions in every Depot", async () => {
    const buy = await trade();
    await trade({ depotId: otherDepotId, quantity: "2" });
    const result = await recordSplit({ securityId: appleId, date: "2024-03-01", ratio: " 1 : 4 " }, db());
    expect(result).toEqual({
      ok: true,
      split: {
        id: expect.any(String),
        security: expect.objectContaining({ id: appleId, name: "Apple Inc." }),
        date: "2024-03-01",
        ratioOld: "1",
        ratioNew: "4",
      },
    });
    expect(await db().corporateAction.count()).toBe(1);
    expect(await db().transaction.findUnique({ where: { id: buy.id } })).toMatchObject({ quantity: "10", price: "400" });

    const [position] = await listPositions(depotId, "2024-06-01", db());
    expect(position).toMatchObject({ quantity: "40", costBasis: "4000", averagePrice: "100", price: "100" });
    const [other] = await listPositions(otherDepotId, "2024-06-01", db());
    expect(other).toMatchObject({ quantity: "8", costBasis: "800", averagePrice: "100" });
    // A split after "today" does not apply yet.
    const [early] = await listPositions(depotId, "2024-02-01", db());
    expect(early).toMatchObject({ quantity: "10", averagePrice: "400" });
  });

  it.each(["0:4", "4:4", "1,5:3", "abc", "", undefined])("rejects ratio %j", async (ratio) => {
    expect(await recordSplit({ securityId: appleId, date: "2024-03-01", ratio }, db())).toEqual({
      ok: false,
      reason: "ratio-invalid",
    });
    expect(await db().corporateAction.count()).toBe(0);
  });

  it("rejects a bad date, an unknown Security and a second split on the same date", async () => {
    expect(await recordSplit({ securityId: appleId, date: "2024-02-30", ratio: "1:4" }, db())).toEqual({
      ok: false,
      reason: "date-invalid",
    });
    expect(await recordSplit({ securityId: "nope", date: "2024-03-01", ratio: "1:4" }, db())).toEqual({
      ok: false,
      reason: "security-not-found",
    });
    await split();
    expect(await recordSplit({ securityId: appleId, date: "2024-03-01", ratio: "1:2" }, db())).toEqual({
      ok: false,
      reason: "split-exists",
    });
    expect(await db().corporateAction.count()).toBe(1);
  });

  it("rejects a reverse split that would oversell a later SELL", async () => {
    await trade();
    await trade({ type: "SELL", date: "2024-05-01", quantity: "5", price: "1" });
    expect(await recordSplit({ securityId: appleId, date: "2024-03-01", ratio: "10:1" }, db())).toEqual({
      ok: false,
      reason: "later-sell-exceeds-holding",
      date: "2024-05-01",
    });
    expect(await db().corporateAction.count()).toBe(0);
  });
});

describe("SELL guard with splits", () => {
  it("accepts a SELL of the split-adjusted quantity and reports availability in post-split units", async () => {
    await trade();
    await split();
    const over = await recordTrade(
      { depotId, type: "SELL", date: "2024-05-01", quantity: "41", price: "100", security: { id: appleId } },
      db(),
    );
    expect(over).toEqual({ ok: false, reason: "sell-exceeds-holding", available: "40" });
    await trade({ type: "SELL", date: "2024-05-01", quantity: "40", price: "100" });
    expect(await listPositions(depotId, "2024-06-01", db())).toEqual([]);
  });

  it("checks an edited pre-split BUY against a post-split SELL", async () => {
    const buy = await trade();
    await split();
    await trade({ type: "SELL", date: "2024-05-01", quantity: "40", price: "100" });
    const result = await updateTransaction(
      buy.id,
      { depotId, type: "BUY", date: "2024-01-02", quantity: "9", price: "400", security: { id: appleId } },
      db(),
    );
    expect(result).toEqual({ ok: false, reason: "later-sell-exceeds-holding", date: "2024-05-01" });
  });
});

describe("updateSplit / deleteSplit", () => {
  it("edits ratio and date, reflected on the next read", async () => {
    await trade();
    const recorded = await split();
    const result = await updateSplit(recorded.id, { date: "2024-04-01", ratio: "1:2" }, db());
    expect(result).toMatchObject({ ok: true, split: { id: recorded.id, date: "2024-04-01", ratioOld: "1", ratioNew: "2" } });
    const [position] = await listPositions(depotId, "2024-06-01", db());
    expect(position.quantity).toBe("20");
  });

  it("rejects unknown ids, invalid input and a date taken by another split", async () => {
    const first = await split("2024-03-01");
    await split("2024-04-01", "1:2");
    expect(await updateSplit("nope", { date: "2024-03-01", ratio: "1:4" }, db())).toEqual({ ok: false, reason: "split-not-found" });
    expect(await updateSplit(first.id, { date: "2024-03-01", ratio: "4:4" }, db())).toEqual({ ok: false, reason: "ratio-invalid" });
    expect(await updateSplit(first.id, { date: "2024-04-01", ratio: "1:4" }, db())).toEqual({ ok: false, reason: "split-exists" });
    // Same date as itself is fine.
    expect(await updateSplit(first.id, { date: "2024-03-01", ratio: "1:3" }, db())).toMatchObject({ ok: true });
    expect(await deleteSplit("nope", db())).toEqual({ ok: false, reason: "split-not-found" });
  });

  it("refuses to delete or shrink a split a later SELL depends on", async () => {
    await trade();
    const recorded = await split();
    await trade({ type: "SELL", date: "2024-05-01", quantity: "40", price: "100" });
    expect(await deleteSplit(recorded.id, db())).toEqual({ ok: false, reason: "later-sell-exceeds-holding", date: "2024-05-01" });
    expect(await updateSplit(recorded.id, { date: "2024-03-01", ratio: "1:2" }, db())).toEqual({
      ok: false,
      reason: "later-sell-exceeds-holding",
      date: "2024-05-01",
    });
    expect(await updateSplit(recorded.id, { date: "2024-06-01", ratio: "1:4" }, db())).toEqual({
      ok: false,
      reason: "later-sell-exceeds-holding",
      date: "2024-05-01",
    });
    expect(await listSplits(db())).toHaveLength(1);
  });

  it("deletes a split nothing depends on", async () => {
    await trade();
    const recorded = await split();
    expect(await deleteSplit(recorded.id, db())).toMatchObject({ ok: true, split: { id: recorded.id } });
    expect(await listSplits(db())).toEqual([]);
  });
});

describe("listSplits", () => {
  it("lists every split ordered by date", async () => {
    await split("2024-05-01", "1:2");
    await split("2024-03-01", "1:4");
    expect((await listSplits(db())).map((s) => [s.date, `${s.ratioOld}:${s.ratioNew}`])).toEqual([
      ["2024-03-01", "1:4"],
      ["2024-05-01", "1:2"],
    ]);
  });
});

describe("archive and held set with splits", () => {
  it("treats BUY 10, split 1:2, SELL 20 as flat and not held", async () => {
    await trade({ price: "10" });
    await split("2024-03-01", "1:2");
    await trade({ type: "SELL", date: "2024-05-01", quantity: "20", price: "5" });
    expect(await listHeldSecurities("2024-06-01", db())).toEqual([]);
    expect((await getDepot(depotId, db()))?.archivable).toBe(true);
    expect((await listDepots(db())).find((depot) => depot.id === depotId)?.archivable).toBe(true);
    expect(await archiveDepot(depotId, db())).toMatchObject({ ok: true });
  });
});
