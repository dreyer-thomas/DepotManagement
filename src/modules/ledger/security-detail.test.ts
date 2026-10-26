import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import type { PriceObservation } from "@/core/prices";
import {
  archiveDepot,
  createDepot,
  ensureSecurity,
  recordIsinChange,
  recordTransaction,
  type RecordTransactionInput,
  securityDetail,
} from "./index";

let testDb: TestDatabase;
let depotA: string;
let depotB: string;
let securityId: string;

const db = () => testDb.client;
const TODAY = "2026-10-26";
const MAX = { kind: "preset", preset: "MAX" } as const;

beforeEach(async () => {
  testDb = createTestDatabase();
  const a = await createDepot({ name: "Alpha", broker: "COMDIRECT" }, db());
  const b = await createDepot({ name: "Beta", broker: "FINANZEN_ZERO" }, db());
  if (!a.ok || !b.ok) throw new Error("setup failed");
  depotA = a.depot.id;
  depotB = b.depot.id;
  const security = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" }, db());
  if (!security.ok) throw new Error("setup failed");
  securityId = security.security.id;
});

afterEach(async () => {
  await testDb.cleanup();
});

async function book(depotId: string, input: Omit<RecordTransactionInput, "depotId">) {
  const result = await recordTransaction({ depotId, ...input }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction;
}

const provider = (date: string, price: string, id = securityId): PriceObservation => ({
  id: `p-${id}-${date}`,
  securityId: id,
  date,
  sequence: 0,
  price,
  source: "provider",
  fetchedAt: `${date}T18:00:00.000Z`,
  provider: "YAHOO",
});

describe("securityDetail", () => {
  it("returns null for an unknown Security", async () => {
    expect(await securityDetail("nope", undefined, MAX, TODAY, db())).toBeNull();
  });

  it("Not booked: no Depots, zero figures", async () => {
    const detail = await securityDetail(securityId, undefined, MAX, TODAY, db());
    expect(detail?.security.name).toBe("Apple Inc.");
    expect(detail?.depots).toEqual([]);
    expect(detail?.selected).toBeNull();
    expect(detail?.transactions).toEqual([]);
    expect(detail?.snapshot.quantity).toBe("0");
    expect(detail?.price).toBeNull();
  });

  it("Two Depots: Alle Depots sums the Depots, a Depot param selects one", async () => {
    await book(depotA, { type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id: securityId } });
    await book(depotB, { type: "BUY", date: "2026-03-02", quantity: "5", price: "120", security: { id: securityId } });
    await book(depotB, { type: "DIVIDEND", date: "2026-04-01", amount: "20", tax: "5", security: { id: securityId } });
    const storedPrices = async (_ids: string[], asOf: string) => [provider("2026-10-20", "110")].filter((p) => p.date <= asOf);

    const all = await securityDetail(securityId, undefined, MAX, TODAY, db(), { storedPrices });
    expect(all?.depots).toEqual([
      { id: depotA, name: "Alpha", archived: false },
      { id: depotB, name: "Beta", archived: false },
    ]);
    expect(all?.selected).toBeNull();
    expect(all?.from).toBe("2026-02-02");
    expect(all?.snapshot).toMatchObject({ quantity: "15", costBasis: "1600", value: "1650", unrealized: "50" });
    expect(all?.series.at(-1)).toMatchObject({ value: "1650", cash: "0" });
    expect(all?.performance.dividends).toBe("20");
    expect(all?.performance.gain).toBe("70");
    expect(all?.price).toMatchObject({ price: "110", date: "2026-10-20", source: "provider" });
    expect(all?.lots.map((entry) => entry.depotName)).toEqual(["Alpha", "Beta"]);
    expect(all?.transactions.map((t) => [t.type, t.depotName])).toEqual([
      ["DIVIDEND", "Beta"],
      ["BUY", "Beta"],
      ["BUY", "Alpha"],
    ]);

    const a = await securityDetail(securityId, depotA, MAX, TODAY, db(), { storedPrices });
    expect(a?.selected).toBe(depotA);
    expect(a?.snapshot).toMatchObject({ quantity: "10", value: "1100" });
    expect(a?.performance.dividends).toBe("0");
    expect(a?.transactions.map((t) => t.depotName)).toEqual(["Alpha"]);
    // MAX starts on the scope's first row.
    expect(a?.from).toBe("2026-02-02");
    const b = await securityDetail(securityId, depotB, MAX, TODAY, db(), { storedPrices });
    expect(b?.from).toBe("2026-03-02");

    // An unknown Depot id falls back to Alle Depots.
    expect((await securityDetail(securityId, "unknown", MAX, TODAY, db()))?.selected).toBeNull();
  });

  it("leaves an archived Depot out of Alle Depots but keeps it selectable", async () => {
    await book(depotA, { type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id: securityId } });
    await book(depotB, { type: "BUY", date: "2026-03-02", quantity: "5", price: "100", security: { id: securityId } });
    await book(depotB, { type: "SELL", date: "2026-04-02", quantity: "5", price: "100", security: { id: securityId } });
    expect((await archiveDepot(depotB, db())).ok).toBe(true);

    const all = await securityDetail(securityId, undefined, MAX, TODAY, db());
    expect(all?.depots.map((depot) => [depot.name, depot.archived])).toEqual([
      ["Alpha", false],
      ["Beta", true],
    ]);
    expect(all?.selected).toBeNull();
    expect(all?.snapshot.quantity).toBe("10");
    expect(all?.transactions.every((t) => t.depotName === "Alpha")).toBe(true);
    const archived = await securityDetail(securityId, depotB, MAX, TODAY, db());
    expect(archived?.selected).toBe(depotB);
    expect(archived?.transactions).toHaveLength(2);
  });

  it("Archived only: defaults to the first archived Depot", async () => {
    await book(depotB, { type: "BUY", date: "2026-03-02", quantity: "5", price: "100", security: { id: securityId } });
    await book(depotB, { type: "SELL", date: "2026-04-02", quantity: "5", price: "110", security: { id: securityId } });
    await book(depotB, { type: "WITHDRAWAL", date: "2026-04-03", amount: "50" });
    expect((await archiveDepot(depotB, db())).ok).toBe(true);
    const detail = await securityDetail(securityId, undefined, MAX, TODAY, db());
    expect(detail?.selected).toBe(depotB);
    expect(detail?.performance.realized).toBe("50");
    // The WITHDRAWAL has no Security: not a scope row.
    expect(detail?.transactions.map((t) => t.type)).toEqual(["SELL", "BUY"]);
  });

  it("ISIN change: the old and the new Security show the same figures, priced as the new one", async () => {
    await book(depotA, { type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id: securityId } });
    const change = await recordIsinChange(
      {
        oldSecurityId: securityId,
        newSecurity: { new: { isin: "US5949181045", name: "Neu AG", assetType: "STOCK" } },
        date: "2026-06-01",
        oldQuantity: "10",
        newQuantity: "10",
      },
      db(),
    );
    if (!change.ok) throw new Error("setup failed");
    const newId = change.isinChange.newSecurity.id;
    const storedPrices = async (_ids: string[], asOf: string) => [provider("2026-10-20", "110", newId)].filter((p) => p.date <= asOf);

    const old = await securityDetail(securityId, undefined, MAX, TODAY, db(), { storedPrices });
    const neu = await securityDetail(newId, undefined, MAX, TODAY, db(), { storedPrices });
    expect(neu?.security.name).toBe("Neu AG");
    expect(old?.security.name).toBe("Apple Inc.");
    for (const detail of [old, neu]) {
      expect(detail?.snapshot).toMatchObject({ quantity: "10", value: "1100" });
      expect(detail?.priceSecurity.id).toBe(newId);
      expect(detail?.price?.price).toBe("110");
      expect(detail?.transactions.map((t) => t.security?.name)).toEqual(["Apple Inc."]);
    }
    expect(neu?.performance).toEqual(old?.performance);
    expect(neu?.series).toEqual(old?.series);
  });

  it("evaluates snapshot, lots and price as of the end of a custom Period", async () => {
    await book(depotA, { type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id: securityId } });
    await book(depotA, { type: "BUY", date: "2026-08-03", quantity: "5", price: "130", security: { id: securityId } });
    const storedPrices = async (_ids: string[], asOf: string) =>
      [provider("2026-05-04", "105"), provider("2026-10-20", "140")].filter((p) => p.date <= asOf);

    const detail = await securityDetail(securityId, undefined, { kind: "custom", from: "2026-03-01", to: "2026-06-30" }, TODAY, db(), {
      storedPrices,
    });
    expect(detail?.from).toBe("2026-03-01");
    expect(detail?.to).toBe("2026-06-30");
    expect(detail?.series.at(-1)?.date).toBe("2026-06-30");
    expect(detail?.snapshot).toMatchObject({ quantity: "10", costBasis: "1000", value: "1050", unrealized: "50" });
    expect(detail?.price).toMatchObject({ price: "105", date: "2026-05-04" });
    expect(detail?.lots).toEqual([
      { depotId: depotA, depotName: "Alpha", lots: [expect.objectContaining({ date: "2026-02-02", quantity: "10", costBasis: "1000" })] },
    ]);
    expect(detail?.performance.gain).toBe("50");
  });

  it("all-time total is independent of the Period; trades and price series follow Period and scope", async () => {
    await book(depotA, { type: "BUY", date: "2026-02-02", quantity: "10", price: "100", fee: "1", security: { id: securityId } });
    await book(depotA, { type: "SELL", date: "2026-05-04", quantity: "4", price: "120", fee: "1", security: { id: securityId } });
    await book(depotA, { type: "BUY", date: "2026-08-03", quantity: "5", price: "130", security: { id: securityId } });
    await book(depotB, { type: "BUY", date: "2026-08-04", quantity: "2", price: "131", security: { id: securityId } });
    const storedPrices = async (_ids: string[], asOf: string) =>
      [provider("2026-05-04", "105"), provider("2026-10-20", "140")].filter((p) => p.date <= asOf);

    const max = await securityDetail(securityId, depotA, MAX, TODAY, db(), { storedPrices });
    const custom = await securityDetail(securityId, depotA, { kind: "custom", from: "2026-04-01", to: "2026-06-30" }, TODAY, db(), {
      storedPrices,
    });
    expect(custom?.total).toEqual(max?.total);
    // Realized 4 × 120 − 1 − 400.4 = 78.6; open 6 @ 100.1 + 5 @ 130 = 1250.6, value 11 × 140 = 1540.
    expect(max?.total).toMatchObject({
      realized: "78.6",
      value: "1540",
      unrealized: "289.4",
      total: "368",
      totalInvested: "1651",
    });

    expect(custom?.trades.map(({ type, date, depotName, quantity, price }) => ({ type, date, depotName, quantity, price }))).toEqual([
      { type: "SELL", date: "2026-05-04", depotName: "Alpha", quantity: "4", price: "120" },
    ]);
    expect(max?.trades.map((trade) => trade.date)).toEqual(["2026-02-02", "2026-05-04", "2026-08-03"]);
    const all = await securityDetail(securityId, undefined, MAX, TODAY, db(), { storedPrices });
    expect(all?.trades.map((trade) => trade.depotName)).toEqual(["Alpha", "Alpha", "Alpha", "Beta"]);
    expect(all?.total.totalInvested).toBe("1913");

    expect(custom?.priceSeries[0]).toEqual({ date: "2026-04-01", price: "100" });
    // On 04.05. the provider Price wins over the trade price.
    expect(custom?.priceSeries.find((point) => point.date === "2026-05-04")?.price).toBe("105");
    expect(custom?.priceSeries.at(-1)).toEqual({ date: "2026-06-30", price: "105" });
    expect(custom?.priceSeries).toHaveLength(91);
  });
});
