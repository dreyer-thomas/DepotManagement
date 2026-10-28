import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createDepot, ensureSecurity, recordSplit, recordTrade } from "@/modules/ledger";
import {
  addWatchlistEntry,
  createWatchlist,
  deleteWatchlist,
  listWatchlists,
  removeWatchlistEntry,
  renameWatchlist,
  securityWatchlistEntries,
  updateWatchlistEntry,
  watchedSecurityIds,
  watchlistPriceTargets,
  watchlistView,
} from "./index";

let testDb: TestDatabase;
const db = () => testDb.client;
const TODAY = "2026-10-28";
const NOW = () => new Date("2026-10-28T10:00:00.000Z");
const SAP = "DE0007164600";
const APPLE = "US0378331005";

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

async function list(name: string) {
  const result = await createWatchlist({ name }, db(), NOW);
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.watchlist.id;
}

async function security(isin: string, name: string) {
  const result = await ensureSecurity({ isin }, { name, assetType: "STOCK" }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.security.id;
}

async function add(watchlistId: string, securityId: string, dateAdded: string = TODAY, note = "") {
  const result = await addWatchlistEntry({ watchlistId, security: { id: securityId }, note, dateAdded }, TODAY, db(), NOW);
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.entry.id;
}

async function price(securityId: string, date: string, value: string) {
  await db().price.create({ data: { securityId, date, source: "PROVIDER", price: value, fetchedAt: `${date}T18:00:00.000Z` } });
}

describe("watchlists", () => {
  it("creates lists at the end in creation order, trimmed and NFC-normalised", async () => {
    const a = await createWatchlist({ name: "  Ideen " }, db(), NOW);
    const b = await createWatchlist({ name: "Café" }, db(), NOW);
    expect(a).toEqual({ ok: true, watchlist: { id: expect.any(String), name: "Ideen", position: 1, entryCount: 0 } });
    expect(b).toMatchObject({ ok: true, watchlist: { name: "Café", position: 2 } });
    expect((await listWatchlists(db())).map((row) => row.name)).toEqual(["Ideen", "Café"]);
    const stored = await db().watchlist.findFirst({ where: { name: "Ideen" } });
    expect(stored?.createdAt).toBe("2026-10-28T10:00:00.000Z");
  });

  it("refuses duplicate (case-insensitive), empty and too long names", async () => {
    await list("Ideen");
    expect(await createWatchlist({ name: "ideen" }, db())).toEqual({ ok: false, reason: "name-taken" });
    expect(await createWatchlist({ name: "  " }, db())).toEqual({ ok: false, reason: "name-empty" });
    expect(await createWatchlist({ name: undefined }, db())).toEqual({ ok: false, reason: "name-empty" });
    expect(await createWatchlist({ name: "x".repeat(61) }, db())).toEqual({ ok: false, reason: "name-too-long" });
    expect((await createWatchlist({ name: "x".repeat(60) }, db())).ok).toBe(true);
  });

  it("renames a list, allowing a case change of its own name but not another list's name", async () => {
    const ideas = await list("Ideen");
    await list("Dividenden");
    expect(await renameWatchlist(ideas, { name: "IDEEN" }, db())).toMatchObject({ ok: true, watchlist: { name: "IDEEN", position: 1 } });
    expect(await renameWatchlist(ideas, { name: "dividenden" }, db())).toEqual({ ok: false, reason: "name-taken" });
    expect(await renameWatchlist("missing", { name: "Neu" }, db())).toEqual({ ok: false, reason: "not-found" });
    expect(await renameWatchlist(ideas, { name: "" }, db())).toEqual({ ok: false, reason: "name-empty" });
  });

  it("deletes a list with its entries, keeping Securities and Prices, and reports the entry count", async () => {
    const ideas = await list("Ideen");
    const other = await list("Andere");
    const sap = await security(SAP, "SAP SE");
    const apple = await security(APPLE, "Apple Inc.");
    await price(sap, "2026-10-27", "100");
    await add(ideas, sap);
    await add(ideas, apple);
    await add(other, sap);
    expect((await listWatchlists(db())).map((row) => row.entryCount)).toEqual([2, 1]);

    expect(await deleteWatchlist(ideas, db())).toEqual({ ok: true, deleted: { entries: 2 } });
    expect(await deleteWatchlist(ideas, db())).toEqual({ ok: false, reason: "not-found" });
    expect(await db().security.count()).toBe(2);
    expect(await db().price.count()).toBe(1);
    expect(await db().watchlistEntry.count()).toBe(1);
  });
});

describe("entries", () => {
  it("adds an existing Security with note and date added (default today), source APP", async () => {
    const ideas = await list("Ideen");
    const sap = await security(SAP, "SAP SE");
    const result = await addWatchlistEntry({ watchlistId: ideas, security: { id: sap }, note: " KGV niedrig " }, TODAY, db(), NOW);
    expect(result).toMatchObject({
      ok: true,
      entry: { watchlistId: ideas, securityId: sap, note: "KGV niedrig", dateAdded: TODAY, position: 1, source: "APP", clientName: null },
      security: { id: sap, name: "SAP SE" },
    });
  });

  it("refuses a Security already on the list, but allows it on another list", async () => {
    const a = await list("A");
    const b = await list("B");
    const sap = await security(SAP, "SAP SE");
    await add(a, sap);
    expect(await addWatchlistEntry({ watchlistId: a, security: { id: sap } }, TODAY, db())).toEqual({ ok: false, reason: "already-on-list" });
    expect((await addWatchlistEntry({ watchlistId: b, security: { id: sap } }, TODAY, db())).ok).toBe(true);
  });

  it("creates an unknown Security through ensureSecurity and reports ledger reasons without creating anything", async () => {
    const ideas = await list("Ideen");
    const created = await addWatchlistEntry(
      { watchlistId: ideas, security: { new: { isin: "de0007164600", name: "SAP SE", assetType: "STOCK" } } },
      TODAY,
      db(),
    );
    expect(created).toMatchObject({ ok: true, security: { isin: SAP, name: "SAP SE", assetType: "STOCK" } });
    const crypto = await addWatchlistEntry(
      { watchlistId: ideas, security: { new: { cryptoSymbol: "btc", name: "Bitcoin", assetType: "CRYPTO" } } },
      TODAY,
      db(),
    );
    expect(crypto).toMatchObject({ ok: true, security: { cryptoSymbol: "BTC" } });

    expect(
      await addWatchlistEntry({ watchlistId: ideas, security: { new: { isin: "DE0007164601", name: "X", assetType: "STOCK" } } }, TODAY, db()),
    ).toEqual({ ok: false, reason: "isin-invalid" });
    expect(
      await addWatchlistEntry({ watchlistId: ideas, security: { new: { isin: APPLE, name: " ", assetType: "STOCK" } } }, TODAY, db()),
    ).toEqual({ ok: false, reason: "security-name-invalid" });
    expect(
      await addWatchlistEntry({ watchlistId: "missing", security: { new: { isin: APPLE, name: "Apple", assetType: "STOCK" } } }, TODAY, db()),
    ).toEqual({ ok: false, reason: "watchlist-not-found" });
    // The same ISIN again: the existing Security, already on the list.
    expect(
      await addWatchlistEntry({ watchlistId: ideas, security: { new: { isin: SAP, name: "Other", assetType: "ETF" } } }, TODAY, db()),
    ).toEqual({ ok: false, reason: "already-on-list" });
    expect(await db().security.count()).toBe(2);
  });

  it("validates note length, date added and the Security", async () => {
    const ideas = await list("Ideen");
    const sap = await security(SAP, "SAP SE");
    const entry = (note: unknown, dateAdded: unknown, securityId = sap) =>
      addWatchlistEntry({ watchlistId: ideas, security: { id: securityId }, note, dateAdded }, TODAY, db());
    expect(await entry("x".repeat(2001), TODAY)).toEqual({ ok: false, reason: "note-too-long" });
    expect(await entry("", "2026-10-29")).toEqual({ ok: false, reason: "date-invalid" });
    expect(await entry("", "31.02.")).toEqual({ ok: false, reason: "date-invalid" });
    expect(await entry("", "2026-02-31")).toEqual({ ok: false, reason: "date-invalid" });
    expect(await entry("", TODAY, "missing")).toEqual({ ok: false, reason: "security-not-found" });
    expect((await entry("x".repeat(2000), "2026-01-15")).ok).toBe(true);
  });

  it("edits note and date, moves to another list, refuses a move where the Security already is, removes", async () => {
    const a = await list("A");
    const b = await list("B");
    const c = await list("C");
    const sap = await security(SAP, "SAP SE");
    const apple = await security(APPLE, "Apple Inc.");
    await price(sap, "2026-10-27", "100");
    const id = await add(a, sap, "2026-10-20", "alt");
    await add(b, apple);
    await add(c, sap);

    expect(await updateWatchlistEntry(id, { note: "neu", dateAdded: "2026-09-01" }, TODAY, db())).toMatchObject({
      ok: true,
      entry: { note: "neu", dateAdded: "2026-09-01", watchlistId: a },
      previousDateAdded: "2026-10-20",
    });
    expect(await updateWatchlistEntry(id, { dateAdded: "2026-10-29" }, TODAY, db())).toEqual({ ok: false, reason: "date-invalid" });
    expect(await updateWatchlistEntry(id, { note: "y".repeat(2001) }, TODAY, db())).toEqual({ ok: false, reason: "note-too-long" });
    expect(await updateWatchlistEntry(id, { watchlistId: c }, TODAY, db())).toEqual({ ok: false, reason: "already-on-list" });
    expect(await updateWatchlistEntry(id, { watchlistId: "missing" }, TODAY, db())).toEqual({ ok: false, reason: "watchlist-not-found" });
    expect(await updateWatchlistEntry(id, { watchlistId: b }, TODAY, db())).toMatchObject({
      ok: true,
      entry: { watchlistId: b, position: 2, note: "neu" },
    });
    expect(await updateWatchlistEntry("missing", { note: "" }, TODAY, db())).toEqual({ ok: false, reason: "not-found" });

    expect(await removeWatchlistEntry(id, db())).toEqual({ ok: true });
    expect(await removeWatchlistEntry(id, db())).toEqual({ ok: false, reason: "not-found" });
    expect(await db().security.count()).toBe(2);
    expect(await db().price.count()).toBe(1);
  });
});

describe("watchlistView", () => {
  it("lists every watchlist with entries, figures and the held flag", async () => {
    const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
    if (!depot.ok) throw new Error("setup failed");
    const ideas = await list("Ideen");
    await list("Leer");
    const sap = await security(SAP, "SAP SE");
    const apple = await security(APPLE, "Apple Inc.");
    const bought = await recordTrade(
      { depotId: depot.depot.id, type: "BUY", date: "2026-09-01", quantity: "1", price: "200", security: { id: apple } },
      db(),
    );
    expect(bought.ok).toBe(true);
    // SAP: unadjusted 100 before a 1:4 split, 26 after it.
    await price(sap, "2026-10-01", "100");
    await price(sap, "2026-10-26", "25");
    await price(sap, "2026-10-27", "26");
    expect((await recordSplit({ securityId: sap, date: "2026-10-15", ratio: "1:4" }, db())).ok).toBe(true);
    await add(ideas, sap, "2026-10-01", "Erste Zeile\nZweite");
    await add(ideas, apple, "2026-10-20");

    const [first, empty] = await watchlistView(TODAY, db());
    expect(empty).toEqual({ id: expect.any(String), name: "Leer", position: 2, entries: [] });
    expect(first.name).toBe("Ideen");
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0]).toMatchObject({
      security: { id: sap, name: "SAP SE", isin: SAP },
      note: "Erste Zeile\nZweite",
      dateAdded: "2026-10-01",
      price: "26",
      priceDate: "2026-10-27",
      priceSource: "provider",
      stale: false,
      changeToday: { perUnit: "1", ratio: "0.04" },
      sinceAdded: "0.04",
      held: false,
    });
    // Apple: only its Transaction price (stale), held.
    expect(first.entries[1]).toMatchObject({
      security: { id: apple },
      price: "200",
      priceSource: "transaction",
      stale: true,
      changeToday: null,
      sinceAdded: "0",
      held: true,
    });
  });

  it("shows '–' figures for a Security without any Price", async () => {
    const ideas = await list("Ideen");
    await add(ideas, await security(SAP, "SAP SE"));
    const [view] = await watchlistView(TODAY, db());
    expect(view.entries[0]).toMatchObject({ price: null, stale: false, changeToday: null, sinceAdded: null, held: false });
  });
});

describe("securityWatchlistEntries / watchedSecurityIds", () => {
  it("lists a Security's entries in list order with change since added; distinct watched ids", async () => {
    const ideas = await list("Ideen");
    const later = await list("Später");
    const sap = await security(SAP, "SAP SE");
    const apple = await security(APPLE, "Apple Inc.");
    await price(sap, "2026-10-01", "100");
    await price(sap, "2026-10-27", "110");
    await add(later, sap, "2026-10-27", "Zweite Liste");
    await add(ideas, sap, "2026-10-01", "Zeile 1\nZeile 2");
    await add(ideas, apple);

    expect(await securityWatchlistEntries(sap, TODAY, db())).toEqual([
      {
        id: expect.any(String),
        watchlistId: ideas,
        watchlistName: "Ideen",
        note: "Zeile 1\nZeile 2",
        dateAdded: "2026-10-01",
        source: "APP",
        clientName: null,
        sinceAdded: "0.1",
      },
      expect.objectContaining({ watchlistId: later, watchlistName: "Später", sinceAdded: "0" }),
    ]);
    expect(await securityWatchlistEntries(apple, TODAY, db())).toEqual([expect.objectContaining({ watchlistName: "Ideen", sinceAdded: null })]);
    expect(await securityWatchlistEntries("unknown", TODAY, db())).toEqual([]);
    expect((await watchedSecurityIds(db())).sort()).toEqual([sap, apple].sort());
  });

  it("watchedSecurityIds is empty without entries", async () => {
    expect(await watchedSecurityIds(db())).toEqual([]);
  });
});

describe("watchlistPriceTargets", () => {
  it("gives each watched Security its history start from the earliest date added", async () => {
    const a = await list("A");
    const b = await list("B");
    const sap = await security(SAP, "SAP SE");
    const apple = await security(APPLE, "Apple Inc.");
    await add(a, sap, "2026-10-20");
    await add(b, sap, "2020-01-11");
    await add(a, apple, "2026-10-01");
    const targets = await watchlistPriceTargets("2026-10-23", db());
    expect(Object.fromEntries(targets)).toEqual({ [sap]: "2020-01-01", [apple]: "2023-10-13" });
    expect((await watchlistPriceTargets("2026-10-23", testDb.client)).size).toBe(2);
  });

  it("is empty without entries", async () => {
    expect((await watchlistPriceTargets(TODAY, db())).size).toBe(0);
  });
});
