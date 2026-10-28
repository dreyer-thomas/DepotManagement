import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { type FetchCall, fakeFetch, json, recorded } from "../../../test/helpers/providers";
import { createDepot, ensureBenchmarkSecurities, ensureSecurity, listHeldSecurities, listPositions, recordSplit, recordTrade, updateTransaction } from "@/modules/ledger";
import {
  backfillHeldPrices,
  deleteManualPrice,
  latestStoredPrices,
  listManualPrices,
  type PriceDeps,
  refetchPriceHistory,
  refreshPrices,
  saveManualPrice,
  securityPriceInfo,
  setMapping,
  storedPriceHistory,
  updateManualPrice,
  type YahooChart,
} from "./index";
import { addWatchlistEntry, createWatchlist, removeWatchlistEntry, watchlistPriceTargets } from "@/modules/watchlist";

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

async function mapTo(securityId: string, provider: "YAHOO" | "ONVISTA" | "COINGECKO" | null, symbol: string | null) {
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

/** Deps that fail any mapping lookup (no network) and use `chart`; `fetch` serves onvista/CoinGecko/Binance. */
function deps(chart: YahooChart, fetch?: PriceDeps["fetch"]): PriceDeps {
  return {
    chart,
    fetch:
      fetch ??
      (async () => {
        throw new Error("no network in tests");
      }),
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

/**
 * Creates the benchmark Securities (as the first price run with ledger rows does) mapped as markers, so
 * a run makes no mapping lookup for them (tests counting provider calls).
 */
async function benchmarkMarkers() {
  for (const securityId of await ensureBenchmarkSecurities(db())) await mapTo(securityId, null, null);
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
    expect(result).toEqual({ updated: 1, failed: [{ securityId: nvidia, name: "NVIDIA", provider: "YAHOO", reason: "unexpected" }] });
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
    expect(result).toEqual({ updated: 1, failed: [{ securityId: nvidia, name: "NVIDIA", provider: "YAHOO", reason: "network" }] });
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
        { securityId: sap, name: "SAP SE", provider: "YAHOO", reason: "currency" },
        { securityId: nvidia, name: "NVIDIA", provider: "YAHOO", reason: "not-found" },
      ]),
    );
    expect(await db().price.count()).toBe(0);
  });

  it("fetches only held mapped Securities; markers and sold-out ones are skipped", async () => {
    const sap = await security(SAP, "SAP SE");
    const marker = await security("US0378331005", "Apple");
    const sold = await security(NVIDIA, "NVIDIA");
    for (const id of [sap, marker, sold]) await buy(id, "2026-10-13");
    const sell = await recordTrade({ depotId, type: "SELL", date: "2026-10-14", quantity: "10", price: "1", security: { id: sold } }, db());
    expect(sell.ok).toBe(true);
    await mapTo(sap, "YAHOO", "SAP.DE");
    await mapTo(marker, null, null);
    await mapTo(sold, "YAHOO", "NVD.DE");
    await benchmarkMarkers();
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });
    const { fetch, calls } = fakeFetch(new Error("unexpected fetch"));
    expect(await refreshPrices("2026-10-23", deps(chart, fetch), db())).toEqual({ updated: 1, failed: [] });
    expect(chart).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
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

  it("serializes runs across module copies (instrumentation and server-action bundles)", async () => {
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
    vi.resetModules();
    const copy = await import("./index");
    expect(copy.refreshPrices).not.toBe(refreshPrices);
    await Promise.all([
      refreshPrices("2026-10-23", deps(chart), db()),
      copy.refreshPrices("2026-10-23", deps(chart), db()),
    ]);
    expect(chart).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
});

describe("certificates and crypto", () => {
  const GOLD = "DE000A0S9GB0";

  beforeEach(benchmarkMarkers);

  async function cryptoSecurity(symbol: string, name: string) {
    const result = await ensureSecurity({ cryptoSymbol: symbol }, { name, assetType: "CRYPTO" }, db());
    if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
    return result.security.id;
  }

  async function certificate() {
    const result = await ensureSecurity({ isin: GOLD }, { name: "Xetra-Gold", assetType: "CERTIFICATE" }, db());
    if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
    return result.security.id;
  }

  /** Fake `fetch` routing by provider host; a missing route is an unexpected call. */
  function providers(replies: { onvista?: Response | Error; onvistaEod?: Response | Error; coingecko?: Response | Error; binance?: Response | Error }) {
    return fakeFetch((call: FetchCall) => {
      const reply = call.url.startsWith("https://api.onvista.de/")
        ? call.url.includes("/query?")
          ? replies.onvista
          : replies.onvistaEod
        : call.url.startsWith("https://api.coingecko.com/")
          ? replies.coingecko
          : call.url.startsWith("https://api.binance.com/")
            ? replies.binance
            : undefined;
      return reply ?? new Error(`unexpected fetch ${call.url}`);
    });
  }

  const onvistaOk = () => ({ onvista: json(recorded("onvista-query-xetra-gold")), onvistaEod: json(recorded("onvista-eod-xetra-gold")) });
  const coingeckoOk = () => json(recorded("coingecko-market-chart-bitcoin"));

  it("stores the recorded onvista closes of a held certificate from its first activity date", async () => {
    const gold = await certificate();
    await buy(gold, "2026-10-01");
    await mapTo(gold, "ONVISTA", GOLD);
    const { fetch, calls } = providers(onvistaOk());
    expect(await refreshPrices("2026-10-23", deps(charts({}), fetch), db())).toEqual({ updated: 1, failed: [] });
    const rows = await providerRows(gold);
    expect(rows).toHaveLength(17);
    expect(rows[0]).toEqual({ date: "2026-10-01", price: "119.05", fetchedAt: NOW.toISOString() });
    expect(rows[16]).toMatchObject({ date: "2026-10-23", price: "114.81" });
    expect(await mapping(gold)).toMatchObject({ historyFrom: "2026-10-01", fetchedAt: NOW.toISOString(), fetchError: null });
    expect(calls[1].url).toContain("startDate=2026-10-01");
  });

  it("stores CoinGecko closes of a recent crypto holding without calling Binance", async () => {
    const btc = await cryptoSecurity("BTC", "Bitcoin");
    await buy(btc, "2026-10-16", "1", "70000");
    await mapTo(btc, "COINGECKO", "bitcoin");
    const { fetch, calls } = providers({ coingecko: coingeckoOk() });
    expect(await refreshPrices("2026-10-23", deps(charts({}), fetch), db())).toEqual({ updated: 1, failed: [] });
    const rows = await providerRows(btc);
    expect(rows.map((row) => row.date)).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(rows[0].price).toBe("72537.3051996502");
    expect(calls).toHaveLength(1);
    expect(await mapping(btc)).toMatchObject({ historyFrom: "2026-10-16", fetchError: null });
  });

  it("sends the CoinGecko key from env with the price fetch only when set", async () => {
    const btc = await cryptoSecurity("BTC", "Bitcoin");
    await buy(btc, "2026-10-16", "1", "70000");
    await mapTo(btc, "COINGECKO", "bitcoin");
    const keyed = providers({ coingecko: coingeckoOk() });
    await refreshPrices("2026-10-23", { ...deps(charts({}), keyed.fetch), env: { COINGECKO_API_KEY: "cg-key" } }, db());
    const chartCall = keyed.calls.find((call) => call.url.includes("/market_chart?"))!;
    expect(chartCall.headers["x-cg-demo-api-key"]).toBe("cg-key");

    const blank = providers({ coingecko: coingeckoOk() });
    await refreshPrices("2026-10-23", { ...deps(charts({}), blank.fetch), env: { COINGECKO_API_KEY: " " } }, db());
    expect(blank.calls).toHaveLength(1);
    expect(Object.keys(blank.calls[0].headers)).not.toContain("x-cg-demo-api-key");
  });

  it("backfills an old crypto holding once from Binance, then refreshes from CoinGecko only", async () => {
    const btc = await cryptoSecurity("BTC", "Bitcoin");
    await buy(btc, "2024-01-01", "1", "40000");
    await mapTo(btc, "COINGECKO", "bitcoin");
    const { fetch, calls } = providers({ coingecko: coingeckoOk(), binance: json(recorded("binance-klines-btceur")) });

    expect(await refreshPrices("2026-10-23", deps(charts({}), fetch), db())).toEqual({ updated: 1, failed: [] });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=365&interval=daily",
      // [first BUY, day before the first CoinGecko date]
      `https://api.binance.com/api/v3/klines?symbol=BTCEUR&interval=1d&startTime=${Date.UTC(2024, 0, 1)}&endTime=${Date.UTC(2026, 9, 15)}&limit=1000`,
    ]);
    const rows = await providerRows(btc);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject({ date: "2024-01-01", price: "40113.43" });
    expect(rows[4]).toMatchObject({ date: "2024-01-05", price: "40463.66" });
    expect(rows[5]).toMatchObject({ date: "2026-10-16", price: "72537.3051996502" });
    expect(await mapping(btc)).toMatchObject({ historyFrom: "2024-01-01", fetchError: null });

    expect(await refreshPrices("2026-10-23", deps(charts({}), fetch), db())).toEqual({ updated: 1, failed: [] });
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toContain("api.coingecko.com");
    expect(await providerRows(btc)).toHaveLength(13);
  });

  it("completes the backfill with CoinGecko closes only when Binance does not know the pair", async () => {
    const btc = await cryptoSecurity("BTC", "Bitcoin");
    await buy(btc, "2024-01-01", "1", "40000");
    await mapTo(btc, "COINGECKO", "bitcoin");
    const { fetch, calls } = providers({ coingecko: coingeckoOk(), binance: json(recorded("binance-klines-invalid-symbol"), 400) });
    expect(await refreshPrices("2026-10-23", deps(charts({}), fetch), db())).toEqual({ updated: 1, failed: [] });
    expect(await providerRows(btc)).toHaveLength(8);
    expect(await mapping(btc)).toMatchObject({ historyFrom: "2024-01-01", fetchError: null });
    await refreshPrices("2026-10-23", deps(charts({}), fetch), db());
    expect(calls.filter((call) => call.url.includes("binance"))).toHaveLength(1);
  });

  it("stores CoinGecko closes and retries the Binance backfill next run after a Binance network failure", async () => {
    const btc = await cryptoSecurity("BTC", "Bitcoin");
    await buy(btc, "2024-01-01", "1", "40000");
    await mapTo(btc, "COINGECKO", "bitcoin");
    const failing = providers({ coingecko: coingeckoOk(), binance: new TypeError("fetch failed") });
    expect(await refreshPrices("2026-10-23", deps(charts({}), failing.fetch), db())).toEqual({ updated: 1, failed: [] });
    expect(await providerRows(btc)).toHaveLength(8);
    expect(await mapping(btc)).toMatchObject({ historyFrom: null, fetchError: null, fetchedAt: NOW.toISOString() });
    expect(console.warn).toHaveBeenCalledWith("Prices: BINANCE BTCEUR backfill failed (network)");

    const working = providers({ coingecko: coingeckoOk(), binance: json(recorded("binance-klines-btceur")) });
    expect(await refreshPrices("2026-10-23", deps(charts({}), working.fetch), db())).toEqual({ updated: 1, failed: [] });
    expect(working.calls.filter((call) => call.url.includes("binance"))).toHaveLength(1);
    expect(await providerRows(btc)).toHaveLength(13);
    expect(await mapping(btc)).toMatchObject({ historyFrom: "2024-01-01" });
  });

  it("reports onvista and CoinGecko failures with their own provider, keeps rows and still updates others", async () => {
    const gold = await certificate();
    const btc = await cryptoSecurity("BTC", "Bitcoin");
    const sap = await security(SAP, "SAP SE");
    for (const id of [gold, btc, sap]) await buy(id, "2026-10-13");
    await mapTo(gold, "ONVISTA", GOLD);
    await mapTo(btc, "COINGECKO", "bitcoin");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await db().price.create({ data: { securityId: gold, date: "2026-10-13", source: "PROVIDER", price: "110", fetchedAt: NOW.toISOString() } });
    const { fetch, calls } = providers({
      onvista: new TypeError("fetch failed"),
      coingecko: json(recorded("coingecko-market-chart-not-found"), 404),
    });
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });

    const result = await refreshPrices("2026-10-23", deps(chart, fetch), db());
    expect(result.updated).toBe(1);
    expect(result.failed).toEqual(
      expect.arrayContaining([
        { securityId: gold, name: "Xetra-Gold", provider: "ONVISTA", reason: "network" },
        { securityId: btc, name: "Bitcoin", provider: "COINGECKO", reason: "not-found" },
      ]),
    );
    expect(result.failed).toHaveLength(2);
    expect(await providerRows(gold)).toEqual([expect.objectContaining({ date: "2026-10-13", price: "110" })]);
    expect(await mapping(gold)).toMatchObject({ fetchError: "network", historyFrom: null });
    expect(await mapping(btc)).toMatchObject({ fetchError: "not-found" });
    expect(await providerRows(sap)).toHaveLength(9);
    // No failover: no other provider was tried.
    expect(calls.every((call) => !call.url.includes("binance"))).toBe(true);
    expect(chart).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(`Prices: ONVISTA ${GOLD} failed (network)`);
  });
});

describe("benchmark ETFs", () => {
  const WORLD = "IE00B4L5Y983";
  const benchmarkId = async (isin: string) => (await db().security.findUnique({ where: { isin }, select: { id: true } }))?.id;

  it("creates no benchmark Security while the ledger has no row", async () => {
    expect(await refreshPrices("2026-10-23", deps(charts({})), db())).toEqual({ updated: 0, failed: [] });
    expect(await db().security.count()).toBe(0);
  });

  it("creates the four benchmark ETFs on a run with a ledger row and tries to map them", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-13");
    // SAP is mapped already: only the benchmarks need a lookup in this run.
    await mapTo(sap, "YAHOO", "SAP.DE");
    const search = vi.fn(async (query: string) => {
      throw new Error(`no network in tests (${query})`);
    });
    await refreshPrices("2026-10-23", { ...deps(charts({})), search }, db());
    const benchmarks = await db().security.findMany({
      where: { isin: { in: [WORLD, "IE00B6R52259", "DE0005933931", "IE00B5BMR087"] } },
      select: { assetType: true },
    });
    expect(benchmarks).toHaveLength(4);
    expect(benchmarks.every((row) => row.assetType === "ETF")).toBe(true);
    expect(search.mock.calls.map(([query]) => query)).toContain(WORLD);
    expect(await listHeldSecurities("2026-10-23", db())).toEqual([sap]);
  });

  it("backfills a mapped benchmark from 10 days before the 3J start on a young ledger, yet never holds it", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-23");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await benchmarkMarkers();
    const world = (await benchmarkId(WORLD))!;
    await db().providerMapping.update({ where: { securityId: world }, data: { provider: "YAHOO", symbol: "EUNL.DE" } });
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de"), "EUNL.DE": recorded("yahoo-chart-sap-de") });

    expect(await refreshPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 2, failed: [] });
    // today − 36 months − 10 days: every preset Period has a base close.
    const worldCall = chart.mock.calls.find(([symbol]) => symbol === "EUNL.DE")!;
    expect(worldCall[1]).toMatchObject({ period1: "2023-10-13", period2: "2026-10-24" });
    expect((await providerRows(world)).map((row) => row.date)[0]).toBe("2026-10-13");
    expect(await providerRows(world)).toHaveLength(9);
    expect(await mapping(world)).toMatchObject({ historyFrom: "2023-10-13", fetchError: null });

    // Not held: no Position, no stale flag; the held Security keeps its own.
    expect(await listHeldSecurities("2026-10-23", db())).toEqual([sap]);
    expect((await listPositions(depotId, "2026-10-23", db())).map((position) => position.security.id)).toEqual([sap]);
    const info = await securityPriceInfo("2026-10-30", db());
    expect(info[world]).toMatchObject({ date: "2026-10-23", stale: false });
    expect(info[sap]).toMatchObject({ stale: true });

    // A backfill-only run has nothing left to do; a first ledger date before the 3J start moves the benchmark start.
    expect(await backfillHeldPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 0, failed: [] });
    await buy(sap, "2023-03-20");
    await backfillHeldPrices("2026-10-23", deps(chart), db());
    expect(chart.mock.calls.filter(([symbol]) => symbol === "EUNL.DE").at(-1)?.[1]).toMatchObject({ period1: "2023-03-10" });
  });

  it("uses the same Security for a held benchmark ISIN, backfilled from the earlier of both dates", async () => {
    // The benchmark start (first ledger date or 3J start, − 10 days) is never after the held ETF's own first activity.
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-17");
    await benchmarkMarkers();
    const world = (await benchmarkId(WORLD))!;
    await buy(world, "2026-10-20", "2", "100");
    await db().providerMapping.update({ where: { securityId: world }, data: { provider: "YAHOO", symbol: "EUNL.DE" } });
    const chart = charts({ "EUNL.DE": recorded("yahoo-chart-sap-de") });

    expect(await refreshPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart.mock.calls[0][1]).toMatchObject({ period1: "2023-10-13" });
    expect(await db().security.count({ where: { isin: WORLD } })).toBe(1);
    expect((await listHeldSecurities("2026-10-23", db())).sort()).toEqual([sap, world].sort());
    expect((await listPositions(depotId, "2026-10-23", db())).map((position) => position.security.id).sort()).toEqual(
      [sap, world].sort(),
    );
  });
});

describe("watched Securities", () => {
  async function watch(securityId: string, dateAdded: string) {
    const list = await createWatchlist({ name: `Liste ${securityId}` }, db());
    if (!list.ok) throw new Error("setup failed");
    const entry = await addWatchlistEntry({ watchlistId: list.watchlist.id, security: { id: securityId }, dateAdded }, "2026-10-23", db());
    if (!entry.ok) throw new Error(`setup failed: ${entry.reason}`);
    return entry.entry.id;
  }
  const watchedDeps = (chart: YahooChart): PriceDeps => ({ ...deps(chart), watched: watchlistPriceTargets });

  it("backfills a watched, unheld Security from watchlistHistoryStart, never holds it, and drops it after it leaves every list", async () => {
    const sap = await security(SAP, "SAP SE");
    await mapTo(sap, "YAHOO", "SAP.DE");
    const entryId = await watch(sap, "2026-10-20");
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });

    // Without the injected loader the Security is not planned at all.
    expect(await refreshPrices("2026-10-23", deps(chart), db())).toEqual({ updated: 0, failed: [] });
    expect(chart).not.toHaveBeenCalled();

    expect(await refreshPrices("2026-10-23", watchedDeps(chart), db())).toEqual({ updated: 1, failed: [] });
    // 3J preset start − 10 days (the date added is later).
    expect(chart.mock.calls[0][1]).toMatchObject({ period1: "2023-10-13", period2: "2026-10-24" });
    expect(await mapping(sap)).toMatchObject({ historyFrom: "2023-10-13", fetchError: null });
    expect((await providerRows(sap)).length).toBeGreaterThan(0);
    expect(await listHeldSecurities("2026-10-23", db())).toEqual([]);
    expect(await backfillHeldPrices("2026-10-23", watchedDeps(chart), db())).toEqual({ updated: 0, failed: [] });

    expect((await removeWatchlistEntry(entryId, db())).ok).toBe(true);
    const stored = (await providerRows(sap)).length;
    chart.mockClear();
    expect(await refreshPrices("2026-10-23", watchedDeps(chart), db())).toEqual({ updated: 0, failed: [] });
    expect(chart).not.toHaveBeenCalled();
    expect(await providerRows(sap)).toHaveLength(stored);
  });

  it("takes the earlier of the first activity date and the watchlist start for a held and watched Security", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-13");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await benchmarkMarkers();
    await watch(sap, "2026-10-20");
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });

    expect(await refreshPrices("2026-10-23", watchedDeps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart.mock.calls[0][1]).toMatchObject({ period1: "2023-10-13" });

    // A first activity before the watchlist start wins.
    await buy(sap, "2020-05-04");
    chart.mockClear();
    await backfillHeldPrices("2026-10-23", watchedDeps(chart), db());
    expect(chart.mock.calls[0][1]).toMatchObject({ period1: "2020-05-04" });
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
      failed: [{ securityId: nvidia, name: "NVIDIA", provider: "YAHOO", reason: "network" }],
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

  it("carries fetchedAt and, for PROVIDER rows, the provider of the current mapping", async () => {
    const sap = await security(SAP, "SAP SE");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await price(sap, "2026-10-21", "PROVIDER", "201");
    await price(sap, "2026-10-19", "MANUAL", "190");
    const observations = await latestStoredPrices([sap], "2026-10-23", db());
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "provider", fetchedAt: NOW.toISOString(), provider: "YAHOO" }),
        expect.objectContaining({ source: "manual", fetchedAt: NOW.toISOString(), provider: null }),
      ]),
    );
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

describe("storedPriceHistory", () => {
  async function price(securityId: string, date: string, source: "MANUAL" | "PROVIDER", value: string) {
    await db().price.create({ data: { securityId, date, source, price: value, fetchedAt: NOW.toISOString() } });
  }

  it("returns every MANUAL and PROVIDER row on or before asOf of the given Securities", async () => {
    const sap = await security(SAP, "SAP SE");
    const nvidia = await security(NVIDIA, "NVIDIA");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await price(sap, "2026-10-19", "MANUAL", "190");
    await price(sap, "2026-10-20", "PROVIDER", "200");
    await price(sap, "2026-10-21", "PROVIDER", "201");
    await price(sap, "2026-10-25", "PROVIDER", "999");
    await price(nvidia, "2026-10-20", "PROVIDER", "100");
    const observations = await storedPriceHistory([sap], "2026-10-23", db());
    expect(
      observations
        .map(({ securityId, date, price, source, sequence, fetchedAt, provider }) => ({ securityId, date, price, source, sequence, fetchedAt, provider }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    ).toEqual([
      { securityId: sap, date: "2026-10-19", price: "190", source: "manual", sequence: 0, fetchedAt: NOW.toISOString(), provider: null },
      { securityId: sap, date: "2026-10-20", price: "200", source: "provider", sequence: 0, fetchedAt: NOW.toISOString(), provider: "YAHOO" },
      { securityId: sap, date: "2026-10-21", price: "201", source: "provider", sequence: 0, fetchedAt: NOW.toISOString(), provider: "YAHOO" },
    ]);
    expect(await storedPriceHistory([], "2026-10-23", db())).toEqual([]);
  });
});

describe("securityPriceInfo", () => {
  async function price(securityId: string, date: string, source: "MANUAL" | "PROVIDER", value: string) {
    await db().price.create({ data: { securityId, date, source, price: value, fetchedAt: NOW.toISOString() } });
  }

  it("gives each Security with a price its latest date and source; stale only for held ones", async () => {
    const sap = await security(SAP, "SAP SE");
    const nvidia = await security(NVIDIA, "NVIDIA");
    const none = await security("US0378331005", "Apple");
    await buy(sap, "2026-10-01");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await price(sap, "2026-10-22", "PROVIDER", "200");
    // NVIDIA: not held, only an old stored price.
    await price(nvidia, "2026-10-01", "MANUAL", "100");

    const info = await securityPriceInfo("2026-10-26", db());
    expect(info[sap]).toEqual({
      date: "2026-10-22",
      source: "provider",
      fetchedAt: NOW.toISOString(),
      provider: "YAHOO",
      stale: true,
    });
    expect(info[nvidia]).toEqual({ date: "2026-10-01", source: "manual", fetchedAt: NOW.toISOString(), provider: null, stale: false });
    expect(info[none]).toBeUndefined();

    await price(sap, "2026-10-23", "MANUAL", "201");
    expect((await securityPriceInfo("2026-10-26", db()))[sap]).toMatchObject({ date: "2026-10-23", source: "manual", stale: false });
  });

  it("falls back to the latest Transaction price", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-24", "1", "150");
    expect((await securityPriceInfo("2026-10-26", db()))[sap]).toEqual({
      date: "2026-10-24",
      source: "transaction",
      fetchedAt: null,
      provider: null,
      stale: false,
    });
  });
});

describe("saveManualPrice", () => {
  const rows = () => db().price.findMany({ select: { date: true, source: true, price: true }, orderBy: { source: "asc" } });

  it("stores a German decimal as a MANUAL row and replaces it on the same date", async () => {
    const sap = await security(SAP, "SAP SE");
    await mapTo(sap, "YAHOO", "SAP.DE");
    await db().providerMapping.update({ where: { securityId: sap }, data: { fetchError: "network" } });
    await db().price.create({ data: { securityId: sap, date: "2026-10-20", source: "PROVIDER", price: "99", fetchedAt: NOW.toISOString() } });

    expect(await saveManualPrice(sap, { date: "2026-10-20", price: "12,34" }, "2026-10-26", db())).toEqual({ ok: true });
    expect(await saveManualPrice(sap, { date: "2026-10-20", price: "1.234,5" }, "2026-10-26", db())).toEqual({ ok: true });
    expect(await rows()).toEqual([
      { date: "2026-10-20", source: "MANUAL", price: "1234.5" },
      { date: "2026-10-20", source: "PROVIDER", price: "99" },
    ]);
    // The mapping and its fetch state stay untouched.
    expect(await mapping(sap)).toMatchObject({ symbol: "SAP.DE", fetchError: "network" });
  });

  it.each([
    [{ date: "2026-10-27", price: "10" }, "date-invalid"],
    [{ date: "2026-02-30", price: "10" }, "date-invalid"],
    [{ date: "", price: "10" }, "date-invalid"],
    [{ date: "2026-10-26", price: "0" }, "price-invalid"],
    [{ date: "2026-10-26", price: "-1" }, "price-invalid"],
    [{ date: "2026-10-26", price: "" }, "price-invalid"],
    [{ date: "2026-10-26", price: "abc" }, "price-invalid"],
    [{ date: "2026-10-26", price: 5 }, "price-invalid"],
  ])("rejects %j with %s and writes nothing", async (input, reason) => {
    const sap = await security(SAP, "SAP SE");
    expect(await saveManualPrice(sap, input, "2026-10-26", db())).toEqual({ ok: false, reason });
    expect(await rows()).toEqual([]);
  });

  it("returns not-found for an unknown Security", async () => {
    expect(await saveManualPrice("missing", { date: "2026-10-26", price: "1" }, "2026-10-26", db())).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("manual Price maintenance", () => {
  const TODAY = "2026-10-26";

  async function price(securityId: string, date: string, source: "MANUAL" | "PROVIDER", value: string) {
    const row = await db().price.create({ data: { securityId, date, source, price: value, fetchedAt: NOW.toISOString() } });
    return row.id;
  }

  const rows = () =>
    db().price.findMany({
      select: { id: true, date: true, source: true, price: true, fetchedAt: true },
      orderBy: [{ date: "asc" }, { source: "asc" }],
    });

  it("lists MANUAL rows per Security, newest first, without PROVIDER rows", async () => {
    const sap = await security(SAP, "SAP SE");
    const nvidia = await security(NVIDIA, "NVIDIA");
    const a = await price(sap, "2026-10-20", "MANUAL", "12.34");
    const b = await price(sap, "2026-10-22", "MANUAL", "1234.56789");
    await price(sap, "2026-10-23", "PROVIDER", "99");
    await price(nvidia, "2026-10-23", "PROVIDER", "99");
    expect(await listManualPrices(db())).toEqual({
      [sap]: [
        { id: b, date: "2026-10-22", price: "1234.56789" },
        { id: a, date: "2026-10-20", price: "12.34" },
      ],
    });
  });

  async function failingMapping(securityId: string) {
    await mapTo(securityId, "YAHOO", "SAP.DE");
    await db().providerMapping.update({
      where: { securityId },
      data: { fetchError: "network", fetchedAt: "2026-10-19T18:00:00.000Z", historyFrom: "2026-10-01" },
    });
    return mapping(securityId);
  }

  it("edits the price of a MANUAL row with a new fetchedAt, leaving the mapping untouched", async () => {
    const sap = await security(SAP, "SAP SE");
    const before = await failingMapping(sap);
    const id = await price(sap, "2026-10-20", "MANUAL", "12.34");
    expect(await updateManualPrice(id, { date: "2026-10-20", price: "13,5" }, TODAY, db())).toEqual({ ok: true });
    const [row] = await rows();
    expect(row).toMatchObject({ id, date: "2026-10-20", price: "13.5" });
    expect(row.fetchedAt).not.toBe(NOW.toISOString());
    expect(await mapping(sap)).toEqual(before);
    expect(before).toMatchObject({ fetchError: "network", fetchedAt: "2026-10-19T18:00:00.000Z", historyFrom: "2026-10-01" });
  });

  it("moves a MANUAL row to a free date, keeping its id", async () => {
    const sap = await security(SAP, "SAP SE");
    const id = await price(sap, "2026-10-20", "MANUAL", "12.34");
    await price(sap, "2026-10-21", "PROVIDER", "99");
    expect(await updateManualPrice(id, { date: "2026-10-21", price: "12,34" }, TODAY, db())).toEqual({ ok: true });
    expect((await rows()).map(({ id: rowId, date, source }) => ({ rowId, date, source }))).toEqual([
      { rowId: id, date: "2026-10-21", source: "MANUAL" },
      { rowId: expect.any(String), date: "2026-10-21", source: "PROVIDER" },
    ]);
  });

  it("refuses to move onto another MANUAL row's date", async () => {
    const sap = await security(SAP, "SAP SE");
    const id = await price(sap, "2026-10-20", "MANUAL", "12.34");
    await price(sap, "2026-10-21", "MANUAL", "20");
    const before = await rows();
    expect(await updateManualPrice(id, { date: "2026-10-21", price: "1" }, TODAY, db())).toEqual({ ok: false, reason: "date-taken" });
    expect(await rows()).toEqual(before);
  });

  it.each([
    [{ date: "2026-10-27", price: "10" }, "date-invalid"],
    [{ date: "2026-10-20", price: "0" }, "price-invalid"],
  ])("rejects an edit %j with %s and changes nothing", async (input, reason) => {
    const sap = await security(SAP, "SAP SE");
    const id = await price(sap, "2026-10-20", "MANUAL", "12.34");
    const before = await rows();
    expect(await updateManualPrice(id, input, TODAY, db())).toEqual({ ok: false, reason });
    expect(await rows()).toEqual(before);
  });

  it("returns not-found for a PROVIDER or unknown id on update and delete", async () => {
    const sap = await security(SAP, "SAP SE");
    const provider = await price(sap, "2026-10-20", "PROVIDER", "99");
    const before = await rows();
    for (const id of [provider, "missing", 42]) {
      expect(await updateManualPrice(id, { date: "2026-10-20", price: "1" }, TODAY, db())).toEqual({ ok: false, reason: "not-found" });
      expect(await deleteManualPrice(id, db())).toEqual({ ok: false, reason: "not-found" });
    }
    expect(await rows()).toEqual(before);
  });

  it("deletes a MANUAL row only; the resolver then picks the provider Price of that date", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-01");
    const mappingBefore = await failingMapping(sap);
    const manual = await price(sap, "2026-10-24", "MANUAL", "120");
    await price(sap, "2026-10-24", "PROVIDER", "110");
    expect((await securityPriceInfo(TODAY, db()))[sap]).toMatchObject({ source: "manual" });
    expect(await deleteManualPrice(manual, db())).toEqual({ ok: true });
    expect((await rows()).map((row) => row.source)).toEqual(["PROVIDER"]);
    expect(await mapping(sap)).toEqual(mappingBefore);
    expect((await securityPriceInfo(TODAY, db()))[sap]).toMatchObject({ date: "2026-10-24", source: "provider", provider: "YAHOO" });
  });

  it("keeps a MANUAL row through full and incremental runs; Positions and price info use it", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-13", "10", "100");
    await mapTo(sap, "YAHOO", "SAP.DE");
    const manual = await price(sap, "2026-10-22", "MANUAL", "999");
    const chart = charts({ "SAP.DE": recorded("yahoo-chart-sap-de") });
    const manualRow = () => db().price.findUnique({ where: { id: manual } });
    const before = await manualRow();

    // Full backfill, then incremental refresh; both store a PROVIDER row on 2026-10-22.
    expect(await refreshPrices("2026-10-22", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(await refreshPrices("2026-10-22", deps(chart), db())).toEqual({ updated: 1, failed: [] });
    expect(chart).toHaveBeenCalledTimes(2);
    expect(chart.mock.calls[1][1]).toMatchObject({ period1: "2026-10-15" });
    expect(await db().price.count({ where: { securityId: sap, date: "2026-10-22", source: "PROVIDER" } })).toBe(1);
    expect(await manualRow()).toEqual(before);

    expect((await securityPriceInfo("2026-10-22", db()))[sap]).toMatchObject({ date: "2026-10-22", source: "manual" });
    const [position] = await listPositions(depotId, "2026-10-22", db(), {
      storedPrices: (ids, asOf) => latestStoredPrices(ids, asOf, db()),
    });
    expect(position).toMatchObject({ price: "999", priceDate: "2026-10-22", value: "9990" });
  });

  it("clears the stale flag of a held Security only for a manual Price within 3 days", async () => {
    const sap = await security(SAP, "SAP SE");
    await buy(sap, "2026-10-01");
    await price(sap, "2026-10-22", "MANUAL", "200");
    expect((await securityPriceInfo(TODAY, db()))[sap]).toMatchObject({ date: "2026-10-22", source: "manual", stale: true });
    await price(sap, "2026-10-23", "MANUAL", "201");
    expect((await securityPriceInfo(TODAY, db()))[sap]).toMatchObject({ date: "2026-10-23", source: "manual", stale: false });
  });
});
