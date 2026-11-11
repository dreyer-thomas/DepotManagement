import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createDepot, ensureSecurity, recordIsinChange, recordSplit, recordTrade } from "@/modules/ledger";
import { breachedPriceMarks, exportPriceMarks, getPriceMarks, priceMarkChartLines, priceMarksView, replaceAllPriceMarks, setPriceMarks } from "./index";

let testDb: TestDatabase;
const db = () => testDb.client;
const TODAY = "2026-11-11";
const NOW = () => new Date("2026-11-11T10:00:00.000Z");

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

async function security(isin: string, name: string) {
  const result = await ensureSecurity({ isin }, { name, assetType: "STOCK" }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.security.id;
}

async function price(securityId: string, date: string, value: string) {
  await db().price.create({ data: { securityId, date, source: "PROVIDER", price: value, fetchedAt: `${date}T18:00:00.000Z` } });
}

const set = (securityId: string, patch: Parameters<typeof setPriceMarks>[1]) => setPriceMarks(securityId, patch, TODAY, db(), NOW);

describe("setPriceMarks", () => {
  it("sets stop and target, and getPriceMarks / priceMarksView return them", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    await price(sap, "2026-11-10", "100");
    const result = await set(sap, {
      stop: { type: "FIXED", value: "90.00", source: " Börse Online ", setDate: "2026-11-01" },
      target: { price: "120", source: "" },
    });
    const marks = {
      securityId: sap,
      stop: { type: "FIXED", value: "90", source: "Börse Online", setDate: "2026-11-01" },
      target: { price: "120", source: null, setDate: TODAY },
    };
    expect(result).toEqual({ ok: true, marks });
    expect(await getPriceMarks(sap, TODAY, db())).toEqual(marks);
    expect(await priceMarksView([sap], TODAY, db())).toEqual({
      [sap]: {
        marks,
        state: {
          price: "100",
          priceDate: "2026-11-10",
          stop: { effective: "90", high: null, distance: "-0.1" },
          target: { price: "120", distance: "0.2" },
          breached: "none",
        },
      },
    });
    const row = await db().priceMark.findUniqueOrThrow({ where: { securityId: sap } });
    expect(row.updatedAt).toBe("2026-11-11T10:00:00.000Z");
  });

  it("keeps omitted marks on a partial patch", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    await set(sap, { stop: { type: "TRAILING", value: "10" }, target: { price: "120" } });
    const result = await set(sap, { target: { price: "130" } });
    expect(result).toMatchObject({ ok: true, marks: { stop: { type: "TRAILING", value: "10" }, target: { price: "130" } } });
  });

  it("deletes the row when both marks are cleared", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    await set(sap, { stop: { type: "FIXED", value: "90" } });
    expect(await set(sap, { stop: null })).toEqual({ ok: true, marks: null });
    expect(await db().priceMark.count()).toBe(0);
    expect(await getPriceMarks(sap, TODAY, db())).toBeNull();
  });

  it("refuses an unknown Security and invalid input without writing", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    expect(await set("missing", { target: { price: "10" } })).toEqual({ ok: false, reason: "not-found" });
    expect(await set(sap, { stop: { type: "TRAILING", value: "60" } })).toEqual({
      ok: false,
      reason: "price-marks-invalid",
      field: "stopValue",
      problem: "out-of-range",
    });
    expect(await set(sap, { target: { price: "10", setDate: "2026-11-12" } })).toMatchObject({ field: "targetSetDate", problem: "future-date" });
    expect(await db().priceMark.count()).toBe(0);
  });

  it("follows an ISIN change: a predecessor's marks apply to the successor, writes move them there", async () => {
    const oldId = await security("DE0007164600", "Alt AG");
    const newId = await security("DE000A1EWWW0", "Neu AG");
    await price(oldId, "2026-10-01", "100");
    await price(newId, "2026-11-10", "48");
    await set(oldId, { stop: { type: "FIXED", value: "90", setDate: "2026-10-01" }, target: { price: "150", setDate: "2026-10-01" } });
    const change = await recordIsinChange({ oldSecurityId: oldId, newSecurity: { id: newId }, date: "2026-10-15", oldQuantity: "1", newQuantity: "2" }, db());
    expect(change.ok).toBe(true);

    // Read: the old row applies to the successor, carried to its units.
    const carried = {
      securityId: newId,
      stop: { type: "FIXED", value: "45", source: null, setDate: "2026-10-01" },
      target: { price: "75", source: null, setDate: "2026-10-01" },
    };
    expect(await getPriceMarks(newId, TODAY, db())).toEqual(carried);
    expect(await getPriceMarks(oldId, TODAY, db())).toEqual(carried);
    const view = await priceMarksView([newId, oldId], TODAY, db());
    expect(view[newId].marks).toEqual(carried);
    expect(view[oldId].marks).toEqual(carried);
    expect(view[newId].state).toMatchObject({ price: "48", stop: { effective: "45" }, target: { price: "75" }, breached: "none" });

    // An unchanged re-save of the read marks (as a prefilled dialog does) keeps the state.
    expect(await set(newId, { stop: carried.stop, target: carried.target })).toEqual({ ok: true, marks: carried });
    expect((await priceMarksView([newId], TODAY, db()))[newId].state).toEqual(view[newId].state);
    // Back to the predecessor row in old units for the partial write below.
    await db().priceMark.updateMany({ data: { securityId: oldId, stopValue: "90", targetPrice: "150" } });

    // Write (partial): the successor's row, the predecessor row removed, the kept target carried.
    const result = await set(oldId, { stop: { type: "FIXED", value: "40" } });
    expect(result).toEqual({
      ok: true,
      marks: { securityId: newId, stop: { type: "FIXED", value: "40", source: null, setDate: TODAY }, target: { price: "75", source: null, setDate: "2026-10-01" } },
    });
    expect(await db().priceMark.findMany({ select: { securityId: true } })).toEqual([{ securityId: newId }]);
    expect((await priceMarksView([newId], TODAY, db()))[newId].state.target).toEqual({ price: "75", distance: "0.5625" });
  });

  it("returns the trailing state with split-adjusted closes", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    await price(sap, "2026-09-20", "300");
    await price(sap, "2026-10-01", "100");
    await price(sap, "2026-10-05", "120");
    await price(sap, "2026-10-20", "52");
    await recordSplit({ securityId: sap, date: "2026-10-15", ratio: "1:2" }, db());
    await set(sap, { stop: { type: "TRAILING", value: "10", setDate: "2026-10-01" } });
    const { state } = (await priceMarksView([sap], TODAY, db()))[sap];
    expect(state.stop).toMatchObject({ high: "60", effective: "54" });
    expect(state.breached).toBe("stop");
  });

  it("lists every requested Security, with null marks where none are set", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    expect(await priceMarksView([sap], TODAY, db())).toEqual({
      [sap]: { marks: null, state: { price: null, priceDate: null, stop: null, target: null, breached: "none" } },
    });
    expect(await priceMarksView([], TODAY, db())).toEqual({});
  });
});

describe("priceMarkChartLines", () => {
  it("returns no lines without marks", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    expect(await priceMarkChartLines(sap, "2026-10-01", TODAY, TODAY, db())).toEqual({ stop: null, target: null });
  });

  it("draws a trailing stop over the chart days and the target in the chart's units", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    await price(sap, "2026-10-01", "100");
    await price(sap, "2026-10-02", "110");
    await price(sap, "2026-10-03", "105");
    await set(sap, { stop: { type: "TRAILING", value: "15", setDate: "2026-10-01" }, target: { price: "130", setDate: "2026-10-01" } });
    const lines = await priceMarkChartLines(sap, "2026-09-30", "2026-10-03", TODAY, db());
    expect(lines).toEqual({
      stop: {
        kind: "trailing",
        points: [
          { date: "2026-09-30", value: null },
          { date: "2026-10-01", value: "85" },
          { date: "2026-10-02", value: "93.5" },
          { date: "2026-10-03", value: "93.5" },
        ],
      },
      target: "130",
    });
    const today = await priceMarkChartLines(sap, "2026-10-01", TODAY, TODAY, db());
    const points = today.stop?.kind === "trailing" ? today.stop.points : [];
    expect(points.at(-1)?.value).toBe((await priceMarksView([sap], TODAY, db()))[sap].state.stop?.effective);
  });

  it("draws marks stored on an ISIN-change predecessor in the units as of the chart end", async () => {
    const oldId = await security("DE0007164600", "Alt AG");
    const newId = await security("DE000A1EWWW0", "Neu AG");
    await price(oldId, "2026-10-01", "100");
    await price(newId, "2026-11-10", "48");
    await set(oldId, { stop: { type: "FIXED", value: "90", setDate: "2026-10-01" }, target: { price: "150", setDate: "2026-10-01" } });
    const change = await recordIsinChange({ oldSecurityId: oldId, newSecurity: { id: newId }, date: "2026-10-15", oldQuantity: "1", newQuantity: "2" }, db());
    expect(change.ok).toBe(true);

    const { state } = (await priceMarksView([newId], TODAY, db()))[newId];
    expect(await priceMarkChartLines(newId, "2026-10-01", TODAY, TODAY, db())).toEqual({
      stop: { kind: "fixed", value: state.stop?.effective },
      target: state.target?.price,
    });
    expect(state).toMatchObject({ stop: { effective: "45" }, target: { price: "75" } });
    // A chart ending before the ISIN change stays in the predecessor's units.
    expect(await priceMarkChartLines(oldId, "2026-10-01", "2026-10-10", TODAY, db())).toEqual({ stop: { kind: "fixed", value: "90" }, target: "150" });
  });
});

describe("breachedPriceMarks", () => {
  async function buy(securityId: string, date: string, priceValue: string) {
    const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
    if (!depot.ok) throw new Error("setup failed");
    const trade = await recordTrade({ depotId: depot.depot.id, type: "BUY", date, quantity: "1", price: priceValue, security: { id: securityId } }, db());
    if (!trade.ok) throw new Error("setup failed");
  }

  it("returns nothing without marks", async () => {
    await security("DE0007164600", "SAP SE");
    expect(await breachedPriceMarks(TODAY, db())).toEqual([]);
  });

  it("lists a breached stop (held) and a reached target (watched only), sorted by name", async () => {
    const zeta = await security("DE0007164600", "Zeta AG");
    const alpha = await security("DE000BASF111", "Alpha AG");
    await buy(zeta, "2026-10-01", "100");
    await price(zeta, "2026-11-10", "85");
    await price(alpha, "2026-11-10", "125");
    await set(zeta, { stop: { type: "FIXED", value: "90", setDate: "2026-10-01" } });
    await set(alpha, { target: { price: "120", setDate: "2026-10-01" } });

    const items = await breachedPriceMarks(TODAY, db());
    expect(items.map((item) => [item.name, item.held, item.state.breached])).toEqual([
      ["Alpha AG", false, "target"],
      ["Zeta AG", true, "stop"],
    ]);
    expect(items[1]).toMatchObject({
      securityId: zeta,
      marks: { stop: { type: "FIXED", value: "90" }, target: null },
      state: { price: "85", priceDate: "2026-11-10", stop: { effective: "90" } },
    });
  });

  it("excludes marks that are not breached and marks without any Price", async () => {
    const between = await security("DE0007164600", "Between AG");
    const unpriced = await security("DE000BASF111", "Unpriced AG");
    await price(between, "2026-11-10", "100");
    await set(between, { stop: { type: "FIXED", value: "90" }, target: { price: "120" } });
    await set(unpriced, { stop: { type: "FIXED", value: "90" }, target: { price: "120" } });
    expect(await breachedPriceMarks(TODAY, db())).toEqual([]);
  });

  it("drops the item once the Price returns or the mark is cleared", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    await price(sap, "2026-11-09", "85");
    await set(sap, { stop: { type: "FIXED", value: "90", setDate: "2026-10-01" } });
    expect(await breachedPriceMarks(TODAY, db())).toHaveLength(1);
    await price(sap, "2026-11-10", "95");
    expect(await breachedPriceMarks(TODAY, db())).toEqual([]);
    await price(sap, "2026-11-11", "80");
    expect(await breachedPriceMarks(TODAY, db())).toHaveLength(1);
    await set(sap, { stop: null });
    expect(await breachedPriceMarks(TODAY, db())).toEqual([]);
  });

  it("keys marks stored on an ISIN-change predecessor by the successor", async () => {
    const oldId = await security("DE0007164600", "Alt AG");
    const newId = await security("DE000A1EWWW0", "Neu AG");
    await price(oldId, "2026-10-01", "100");
    await price(newId, "2026-11-10", "40");
    await set(oldId, { stop: { type: "FIXED", value: "90", setDate: "2026-10-01" } });
    const change = await recordIsinChange({ oldSecurityId: oldId, newSecurity: { id: newId }, date: "2026-10-15", oldQuantity: "1", newQuantity: "2" }, db());
    expect(change.ok).toBe(true);
    const items = await breachedPriceMarks(TODAY, db());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ securityId: newId, name: "Neu AG", state: { breached: "stop", stop: { effective: "45" } } });
  });
});

describe("export and restore", () => {
  it("round-trips the rows", async () => {
    const sap = await security("DE0007164600", "SAP SE");
    await set(sap, { stop: { type: "TRAILING", value: "7.5", source: "Analyst" } });
    const exported = await exportPriceMarks(db());
    expect(exported).toEqual([
      { id: expect.any(String), securityId: sap, stop: { type: "TRAILING", value: "7.5", source: "Analyst", setDate: TODAY }, target: null },
    ]);
    await replaceAllPriceMarks([], db());
    expect(await exportPriceMarks(db())).toEqual([]);
    await replaceAllPriceMarks(exported, db(), NOW);
    expect(await exportPriceMarks(db())).toEqual(exported);
  });
});
