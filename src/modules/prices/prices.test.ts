import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { recorded } from "../../../test/helpers/providers";
import { createDepot, ensureSecurity, listPositions, recordSplit, recordTrade, updateTransaction } from "@/modules/ledger";
import {
  backfillHeldPrices,
  latestStoredPrices,
  type PriceDeps,
  refetchPriceHistory,
  refreshPrices,
  setMapping,
  type YahooChart,
} from "./index";

let testDb: TestDatabase;
let depotId: string;

beforeEach(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.cleanup();
});

const db = () => testDb.client;
const NOW = new Date("2026-10-23T18:00:00.000Z");
const SAP = "DE0007164600";
const NVIDIA = "US67066G1040";

async function security(isin: string, name: string) {
  const result = await ensureSecurity({ isin }, { name, assetType: "STOCK" }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.security.id;
}

async function buy(securityId: string, date: string, quantity = "10", price = "100") {
  const result = await recordTrade({ depotId, type: "BUY", date, quantity, price, security: { id: securityId } }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction.id;
}

async function mapTo(securityId: string, provider: "YAHOO" | "ONVISTA" | null, symbol: string | null) {
  await db().providerMapping.create({ data: { securityId, provider, symbol, origin: "AUTO", updatedAt: NOW.toISOString() } });
}

/** Fake `chart()` serving a reply per symbol; an Error reply rejects. Never touches the network. */
function charts(replies: Record<string, unknown>) {
  return vi.fn<YahooChart>(async (symbol) => {
    const reply = replies[symbol];
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new Error(`unexpected chart call for ${symbol}`);
    return reply;
  });
}

/** Deps that fail any mapping lookup (no network) and use `chart`. */
function deps(chart: YahooChart): PriceDeps {
  return {
    chart,
    fetch: async () => {
      throw new Error("no network in tests");
    },
    search: async () => {
      throw new Error("no network in tests");
    },
    env: {},
    now: () => NOW,
  };
}

async function providerRows(securityId: string) {
  return db().price.findMany({
    where: { securityId, source: "PROVIDER" },
    orderBy: { date: "asc" },
    select: { date: true, price: true, fetchedAt: true },
  });
}

const mapping = (securityId: string) => db().providerMapping.findUnique({ where: { securityId } });

describe("refreshPrices", () => {
  it("backfills a held Yahoo Security from its first activity date, then refreshes without duplicates", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-13");
    await mapTo(sap, "YAHOO", "SAP.DE");
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });

    expect(await refreshPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart.mock.calls[0][1]).toMatchObject({ period1: "2026-10-13", period2: "2026-10-24" });
    const rows = await providerRows(sap);
    expect(rows.map((row) => row.date)).toEqual([
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(rows[0]).toEqual({ date: "2026-10-13", price: "197.28", fetchedAt: "2026-10-23T18:00:00.000Z" });
    expect(rows.every((row) => typeof row.price === "string")).toBe(true);
    expect(await mapping(sap)).toMatchObject({ historyFrom: "2026-10-13", fetchedAt: NOW.toISOString(), fetchError: null });

    // Incremental: 7 days of overlap before the latest stored row, replaced in place.
    expect(await refreshPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart.mock.calls[1][1]).toMatchObject({ period1: "2026-10-16", period2: "2026-10-24" });
    expect(await providerRows(sap)).toHaveLength(9);
  });

  it("stores unadjusted closes around a recorded split (NVD.DE, 1:10 on 2024-06-10)", async () => {
    const nvidia = await security(NVIDIA, "NVIDIA");
    await buy(nvidia, "2024-06-03", "1", "1000");
    await mapTo(nvidia, "YAHOO", "NVD.DE");
    expect((await recordSplit({ securityId: nvidia, date: "2024-06-10", ratio: "1:10" }, db())).ok).toBe(true);
    const chart = charts({ "NVD.DE": recorded("yahoo-chart-nvd-de-split") });
    expect(await refreshPrices("2024-06-14", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    const stored = new Map((await providerRows(nvidia)).map((row) => [row.date, row.price]));
    expect(stored.size).toBe(10);
    expect(stored.get("2024-06-07")).toBe("1104.4");
    expect(stored.get("2024-06-10")).toBe("114.22");
  });

  it("does not undo a split dated after today (the provider has not adjusted for it yet)", async () => {
    const nvidia = await security(NVIDIA, "NVIDIA");
    await buy(nvidia, "2024-06-03", "1", "1000");
    await mapTo(nvidia, "YAHOO", "NVD.DE");
    expect((await recordSplit({ securityId: nvidia, date: "2024-06-20", ratio: "1:10" }, db())).ok).toBe(true);
    const chart = charts({ "NVD.DE": recorded("yahoo-chart-nvd-de-split") });
    expect(await refreshPrices("2024-06-14", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    const stored = new Map((await providerRows(nvidia)).map((row) => [row.date, row.price]));
    expect(stored.get("2024-06-07")).toBe("110.44");
    expect(stored.get("2024-06-10")).toBe("114.22");
  });

  it("records an unexpected failure when storing one Security fails, keeps its rows and stores the other", async () => {
    const sap = await security(SAP, "SAP SE");
    const nvidia = await security(NVIDIA, "NVIDIA");
    await buy(sap, "2026-10-13");
    await buy(nvidia, "2026-10-13");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await mapTo(nvidia, "YAHOO", "SAP.DE");
    await db().price.create({ data: { securityId: nvidia, date: "2026-10-13", source: "PROVIDER", price: "150", fetchedAt: NOW.toISOString() } });
    // A write error for NVIDIA's rows only (e.g. a locked or full database).
    await db().$executeRawUnsafe(
      `CREATE TRIGGER fail_price BEFORE INSERT ON "Price" WHEN NEW."securityId" = '${nvidia}' BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
    );
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });

    const result = await refreshPrices("2026-10-23", deps(chart), db());
    expect(result).toEqual({ updated: 1, failed: [{ securityId: nvidia, name: "NVIDIA", reason: "unexpected" }] });
    expect(await providerRows(sap)).toHaveLength(9);
    expect(await providerRows(nvidia)).toEqual([expect.objectContaining({ date: "2026-10-13", price: "150" })]);
    expect(await mapping(nvidia)).toMatchObject({ fetchError: "unexpected", historyFrom: null });
  });

  it("stores the other Security's Prices when one fails, returns and records the failure, keeps existing rows", async () => {
    const sap = await security(SAP, "SAP SE");
    const nvidia = await security(NVIDIA, "NVIDIA");
    await buy(sap, "2026-10-13");
    await buy(nvidia, "2026-10-13");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await mapTo(nvidia, "YAHOO", "NVD.DE");
    await db().price.create({ data: { securityId: nvidia, date: "2026-10-13", source: "PROVIDER", price: "150", fetchedAt: NOW.toISOString() } });
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de"), "NVD.DE": new TypeError("fetch failed") });

    const result = await refreshPrices("2026-10-23", deps(chart), db());
    expect(result).toEqual({ updated: 1, failed: [{ securityId: nvidia, name: "NVIDIA", reason: "network" }] });
    expect(await providerRows(sap)).toHaveLength(9);
    expect(await providerRows(nvidia)).toEqual([expect.objectContaining({ date: "2026-10-13", price: "150" })]);
    expect(await mapping(nvidia)).toMatchObject({ fetchError: "network", historyFrom: null, fetchedAt: null });
    // Logs name provider, symbol and reason only.
    expect(console.warn).toHaveBeenCalledWith("Prices: YAHOO NVD.DE failed (network)");
  });

  it("records a currency failure for a non-EUR listing and a not-found for an unknown symbol", async () => {
    const sap = await security(SAP, "SAP SE");
    const nvidia = await security(NVIDIA, "NVIDIA");
    await buy(sap, "2026-10-19");
    await buy(nvidia, "2026-10-19");
    await mapTo(sap, "YAHOO", "AAPL");
    await mapTo(nvidia, "YAHOO", "NOPE.DE");
    const chart = charts({ AAPL: recorded("yahoo-chart-aapl-usd"), "NOPE.DE": new Error("No data found, symbol may be delisted") });
    const result = await refreshPrices("2026-10-23", deps(chart), db());
    expect(result.updated).toBe(0);
    expect(result.failed).toEqual(
      expect.arrayContaining([
        { securityId: sap, name: "SAP SE", reason: "currency" },
        { securityId: nvidia, name: "NVIDIA", reason: "not-found" },
      ]),
    );
    expect(await db().price.count()).toBe(0);
  });

  it("fetches only held Securities mapped to Yahoo; markers, other providers and sold-out ones are skipped", async () => {
    const sap = await security(SAP, "SAP SE");
    const marker = await security("US0378331005", "Apple");
    const turbo = await security("DE0005557508", "Telekom");
    const sold = await security(NVIDIA, "NVIDIA");
    for (const id of [sap, marker, turbo, sold]) await buy(id, "2026-10-13");
    const sell = await recordTrade({ depotId, type: "SELL", date: "2026-10-14", quantity: "10", price: "1", security: { id: sold } }, db());
    expect(sell.ok).toBe(true);
    await mapTo(sap, "YAHOO", "SAP.DE");
    await mapTo(marker, null, null);
    await mapTo(turbo, "ONVISTA", "DE0005557508");
    await mapTo(sold, "YAHOO", "NVD.DE");
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });
    expect(await refreshPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart).toHaveBeenCalledTimes(1);
  });

  it("resolves missing mappings first (a transient lookup failure leaves the Security unfetched)", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-13");
    const chart = charts({});
    expect(await refreshPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 0, failed: [] });
    expect(chart).not.toHaveBeenCalled();
  });

  it("writes nothing when the mapping changes while the fetch runs", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-13");
    await mapTo(sap, "YAHOO", "SAP.DE");
    const chart = vi.fn<YahooChart>(async () => {
      expect((await setMapping(sap, { provider: "YAHOO", symbol: "SAP.F" }, db())).ok).toBe(true);
      return recorded("yahoo-chart-sap-de");
    });
    expect(await refreshPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 0, failed: [] });
    expect(await providerRows(sap)).toEqual([]);
    expect(await mapping(sap)).toMatchObject({ symbol: "SAP.F", historyFrom: null, fetchedAt: null, fetchError: null });
  });

  it("serializes concurrent runs", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-13");
    await mapTo(sap, "YAHOO", "SAP.DE");
    let active = 0;
    let maxActive = 0;
    const chart = vi.fn<YahooChart>(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return recorded("yahoo-chart-sap-de");
    });
    const results = await Promise.all([
      refreshPrices("2026-10-23", deps(chart), db()),
      refreshPrices("2026-10-23", deps(chart), db()),
    ]);
    expect(results).toEqual([
      { updated: 1, failed: [] },
      { updated: 1, failed: [] },
    ]);
    expect(maxActive).toBe(1);
    expect(await providerRows(sap)).toHaveLength(9);
  });
});

describe("backfillHeldPrices", () => {
  it("fetches only Securities needing a full backfill, and again when the first activity moves earlier", async () => {
    const sap = await security(SAP, "SAP SE");
    const buyId = await buy(sap, "2026-10-15");
    await mapTo(sap, "YAHOO", "SAP.DE");
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });

    expect(await backfillHeldPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect((await providerRows(sap))[0].date).toBe("2026-10-15");
    expect(await backfillHeldPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 0, failed: [] });
    expect(chart).toHaveBeenCalledTimes(1);

    // Back-dated BUY: full backfill from the new first activity date.
    const moved = await updateTransaction(
      buyId,
      { depotId, type: "BUY", date: "2026-10-13", quantity: "10", price: "100", security: { id: sap } },
      db(),
    );
    expect(moved.ok).toBe(true);
    expect(await backfillHeldPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart.mock.calls[1][1]).toMatchObject({ period1: "2026-10-13" });
    expect(await providerRows(sap)).toHaveLength(9);
    expect(await mapping(sap)).toMatchObject({ historyFrom: "2026-10-13" });
  });

  it("backfills again after the mapping was edited", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-13");
    await mapTo(sap, "YAHOO", "SAP.F");
    const chart = charts({ "SAP.F": recorded("yahoo-chart-sap-de"), "SAP.DE": recorded("yahoo-chart-sap-de") });
    await backfillHeldPrices("2026-10-23", deps(chart), db());
    expect((await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db())).ok).toBe(true);
    expect(await providerRows(sap)).toEqual([]);
    expect(await backfillHeldPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart.mock.calls.map(([symbol]) => symbol)).toEqual(["SAP.F", "SAP.DE"]);
    expect(await providerRows(sap)).toHaveLength(9);
  });
});

describe("refetchPriceHistory", () => {
  it("replaces all PROVIDER rows after a split is recorded; a failure keeps them and records the error", async () => {
    const nvidia = await security(NVIDIA, "NVIDIA");
    await buy(nvidia, "2024-06-03", "1", "1000");
    await mapTo(nvidia, "YAHOO", "NVD.DE");
    const fixture = recorded("yahoo-chart-nvd-de-split");
    const chart = charts({ "NVD.DE": fixture });
    await refreshPrices("2024-06-14", deps(chart), db());
    expect((await providerRows(nvidia)).find((row) => row.date === "2024-06-07")?.price).toBe("110.44");

    expect((await recordSplit({ securityId: nvidia, date: "2024-06-10", ratio: "1:10" }, db())).ok).toBe(true);
    const failing = charts({ "NVD.DE": new TypeError("fetch failed") });
    expect(await refetchPriceHistory(nvidia, "2024-06-14", deps(failing), db())).toEqual({
      updated: 0,
      failed: [{ securityId: nvidia, name: "NVIDIA", reason: "network" }],
    });
    expect((await providerRows(nvidia)).find((row) => row.date === "2024-06-07")?.price).toBe("110.44");
    // The failed full refetch clears `historyFrom`, so the next backfill retries it.
    expect(await mapping(nvidia)).toMatchObject({ fetchError: "network", historyFrom: null });

    expect(await backfillHeldPrices("2024-06-14", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart.mock.calls[1][1]).toMatchObject({ period1: "2024-06-03" });
    const rows = await providerRows(nvidia);
    expect(rows).toHaveLength(10);
    expect(rows.find((row) => row.date === "2024-06-07")?.price).toBe("1104.4");
    expect(await mapping(nvidia)).toMatchObject({ fetchError: null, historyFrom: "2024-06-03" });
  });

  it("refetches a sold-out Security that has provider Prices, from its first activity date", async () => {
    const nvidia = await security(NVIDIA, "NVIDIA");
    await buy(nvidia, "2024-06-03", "1", "1000");
    await mapTo(nvidia, "YAHOO", "NVD.DE");
    const chart = charts({ "NVD.DE": recorded("yahoo-chart-nvd-de-split") });
    expect(await refreshPrices("2024-06-14", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    const sell = await recordTrade({ depotId, type: "SELL", date: "2024-06-07", quantity: "1", price: "1100", security: { id: nvidia } }, db());
    expect(sell.ok).toBe(true);
    expect((await recordSplit({ securityId: nvidia, date: "2024-06-10", ratio: "1:10" }, db())).ok).toBe(true);

    expect(await refetchPriceHistory(nvidia, "2024-06-14", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart.mock.calls[1][1]).toMatchObject({ period1: "2024-06-03" });
    const rows = await providerRows(nvidia);
    expect(rows).toHaveLength(10);
    expect(rows[0].date).toBe("2024-06-03");
    expect(rows.find((row) => row.date === "2024-06-07")?.price).toBe("1104.4");
    expect(rows.find((row) => row.date === "2024-06-10")?.price).toBe("114.22");
  });

  it("does nothing for a Security not mapped to Yahoo, or neither held nor with provider Prices", async () => {
    const sap = await security(SAP, "SAP SE");
    const idle = await security(NVIDIA, "NVIDIA");
    await buy(sap, "2026-10-13");
    await mapTo(sap, "ONVISTA", SAP);
    await mapTo(idle, "YAHOO", "NVD.DE");
    const chart = charts({});
    expect(await refetchPriceHistory(sap, "2026-10-23", deps(chart), db())).toEqual({ updated: 0, failed: [] });
    expect(await refetchPriceHistory(idle, "2026-10-23", deps(chart), db())).toEqual({ updated: 0, failed: [] });
    expect(chart).not.toHaveBeenCalled();
  });
});

describe("latestStoredPrices and Positions", () => {
  async function price(securityId: string, date: string, source: "MANUAL" | "PROVIDER", value: string) {
    await db().price.create({ data: { securityId, date, source, price: value, fetchedAt: NOW.toISOString() } });
  }

  it("returns the latest MANUAL and PROVIDER row on or before asOf per Security", async () => {
    const sap = await security(SAP, "SAP SE");
    await price(sap, "2026-10-20", "PROVIDER", "200");
    await price(sap, "2026-10-21", "PROVIDER", "201");
    await price(sap, "2026-10-25", "PROVIDER", "999");
    await price(sap, "2026-10-19", "MANUAL", "190");
    const observations = await latestStoredPrices([sap], "2026-10-23", db());
    expect(observations.map(({ date, price, source, sequence }) => ({ date, price, source, sequence }))).toEqual(
      expect.arrayContaining([
        { date: "2026-10-21", price: "201", source: "provider", sequence: 0 },
        { date: "2026-10-19", price: "190", source: "manual", sequence: 0 },
      ]),
    );
    expect(observations).toHaveLength(2);
    expect(await latestStoredPrices([], "2026-10-23", db())).toEqual([]);
  });

  it("values Positions with MANUAL over PROVIDER over the Transaction price, carrying forward the latest", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-20", "10", "100");
    const positions = () =>
      listPositions(depotId, "2026-10-22", db(), { storedPrices: (ids, asOf) => latestStoredPrices(ids, asOf, db()) });

    expect((await positions())[0]).toMatchObject({ price: "100", priceDate: "2026-10-20", value: "1000" });
    await price(sap, "2026-10-20", "PROVIDER", "110");
    expect((await positions())[0]).toMatchObject({ price: "110", priceDate: "2026-10-20", value: "1100" });
    await price(sap, "2026-10-20", "MANUAL", "120");
    expect((await positions())[0]).toMatchObject({ price: "120", priceDate: "2026-10-20", value: "1200" });
    // A later provider Price wins by date; one after "today" is ignored.
    await price(sap, "2026-10-21", "PROVIDER", "130");
    await price(sap, "2026-10-23", "MANUAL", "999");
    expect((await positions())[0]).toMatchObject({ price: "130", priceDate: "2026-10-21", value: "1300" });
  });

  it("applies later splits to stored (unadjusted) Prices on read", async () => {
    const nvidia = await security(NVIDIA, "NVIDIA");
    await buy(nvidia, "2024-06-03", "1", "1000");
    await price(nvidia, "2024-06-07", "PROVIDER", "1104.4");
    expect((await recordSplit({ securityId: nvidia, date: "2024-06-10", ratio: "1:10" }, db())).ok).toBe(true);
    const [position] = await listPositions(depotId, "2024-06-10", db(), {
      storedPrices: (ids, asOf) => latestStoredPrices(ids, asOf, db()),
    });
    expect(position).toMatchObject({ quantity: "10", price: "110.44", value: "1104.4" });
  });
});
