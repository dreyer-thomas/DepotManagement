import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { type FetchCall, fakeFetch, json, recorded } from "../../../test/helpers/providers";
import { ensureSecurity } from "@/modules/ledger";
import {
  listSecuritiesWithMappings,
  type MappingDeps,
  resolveMapping,
  resolveMappingFor,
  resolveMissingMappings,
  setMapping,
} from "./index";

let testDb: TestDatabase;

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

const db = () => testDb.client;
const NOW = new Date("2026-10-26T08:00:00.000Z");

const SAP = "DE0007164600";
const MSCI_WORLD = "IE00B4L5Y983";
const XTRACKERS = "LU0274208692";
/** Any valid ISIN; certificates resolve without a network call. */
const TURBO = "DE0005557508";

async function security(identifier: { isin: string } | { cryptoSymbol: string }, name: string, assetType: string) {
  const result = await ensureSecurity(identifier, { name, assetType }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.security;
}

const openFigiNotFound = (call: FetchCall) => json(JSON.parse(call.body!).map(() => ({ warning: "No identifier found." })));

/** Routes fake requests: OpenFIGI → `openfigi`, CoinGecko → `coingecko`; Yahoo search by ISIN → `yahoo[isin]`. */
function providers({
  openfigi = openFigiNotFound,
  coingecko = (): Response | Error => json(recorded("coingecko-search-not-found")),
  yahoo = {} as Record<string, unknown>,
}: {
  openfigi?: (call: FetchCall) => Response | Error;
  coingecko?: (call: FetchCall) => Response | Error;
  yahoo?: Record<string, unknown>;
} = {}) {
  const { fetch, calls } = fakeFetch((call) => (call.url.includes("openfigi") ? openfigi(call) : coingecko(call)));
  const search = vi.fn(async (isin: string) => {
    const reply = yahoo[isin] ?? recorded("yahoo-search-not-found");
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const deps: MappingDeps = { fetch, search, env: {}, now: () => NOW };
  return { deps, calls, search };
}

async function rows() {
  return db().providerMapping.findMany({
    select: { securityId: true, provider: true, symbol: true, origin: true, updatedAt: true },
    orderBy: { securityId: "asc" },
  });
}

describe("resolveMapping", () => {
  const lookups = {
    xetraTicker: vi.fn(),
    germanListing: vi.fn(),
    coinId: vi.fn(),
  };

  beforeEach(() => {
    lookups.xetraTicker.mockReset();
    lookups.germanListing.mockReset();
    lookups.coinId.mockReset();
  });

  const stock = { isin: SAP, cryptoSymbol: null, assetType: "STOCK" as const };

  it("maps a Xetra ticker to <T>.DE without asking Yahoo", async () => {
    lookups.xetraTicker.mockResolvedValue({ status: "found", value: "SAP" });
    expect(await resolveMapping(stock, lookups)).toEqual({ status: "mapped", provider: "YAHOO", symbol: "SAP.DE" });
    expect(lookups.germanListing).not.toHaveBeenCalled();
  });

  it.each([
    ["not-found", "found", { status: "mapped", provider: "YAHOO", symbol: "X.F" }],
    ["error", "found", { status: "mapped", provider: "YAHOO", symbol: "X.F" }],
    ["not-found", "not-found", { status: "not-found" }],
    ["error", "not-found", { status: "error" }],
    ["not-found", "error", { status: "error" }],
    ["error", "error", { status: "error" }],
  ])("OpenFIGI %s + Yahoo %s → %j", async (xetra, german, expected) => {
    lookups.xetraTicker.mockResolvedValue({ status: xetra });
    lookups.germanListing.mockResolvedValue(german === "found" ? { status: "found", value: "X.F" } : { status: german });
    expect(await resolveMapping(stock, lookups)).toEqual(expected);
  });

  it("maps a certificate to onvista by ISIN without any lookup", async () => {
    expect(await resolveMapping({ isin: "DE000SYN0001", cryptoSymbol: null, assetType: "CERTIFICATE" }, lookups)).toEqual({
      status: "mapped",
      provider: "ONVISTA",
      symbol: "DE000SYN0001",
    });
    expect(lookups.xetraTicker).not.toHaveBeenCalled();
    expect(lookups.germanListing).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "found", value: "bitcoin" }, { status: "mapped", provider: "COINGECKO", symbol: "bitcoin" }],
    [{ status: "not-found" }, { status: "not-found" }],
    [{ status: "error" }, { status: "error" }],
  ])("crypto: CoinGecko %j → %j", async (coin, expected) => {
    lookups.coinId.mockResolvedValue(coin);
    expect(await resolveMapping({ isin: null, cryptoSymbol: "BTC", assetType: "CRYPTO" }, lookups)).toEqual(expected);
    expect(lookups.coinId).toHaveBeenCalledWith("BTC");
  });
});

describe("resolveMissingMappings", () => {
  it("creates AUTO rows per the I/O matrix from recorded responses", async () => {
    const sap = await security({ isin: SAP }, "SAP", "STOCK");
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    const xtrackers = await security({ isin: XTRACKERS }, "Xtrackers MSCI World", "ETF");
    const turbo = await security({ isin: TURBO }, "Turbo-Zertifikat", "CERTIFICATE");
    const btc = await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    const { deps, calls, search } = providers({
      openfigi: (call) => {
        const isins = JSON.parse(call.body!).map((job: { idValue: string }) => job.idValue);
        const recordedJobs = recorded("openfigi-mapping-sap-msci-world-apple") as unknown[];
        return json(isins.map((isin: string) => (isin === SAP ? recordedJobs[0] : recordedJobs[1])));
      },
      coingecko: () => json(recorded("coingecko-search-btc")),
      yahoo: {
        [MSCI_WORLD]: recorded("yahoo-search-ishares-core-msci-world"),
        [XTRACKERS]: recorded("yahoo-search-xtrackers-msci-world"),
      },
    });

    const result = await resolveMissingMappings(deps, db());

    expect(result).toEqual({ mapped: 4, notFound: 1, failed: [] });
    const byId = Object.fromEntries((await rows()).map(({ securityId, ...row }) => [securityId, row]));
    const at = NOW.toISOString();
    expect(byId).toEqual({
      [sap.id]: { provider: "YAHOO", symbol: "SAP.DE", origin: "AUTO", updatedAt: at },
      [msci.id]: { provider: null, symbol: null, origin: "AUTO", updatedAt: at },
      [xtrackers.id]: { provider: "YAHOO", symbol: "DBXW.DE", origin: "AUTO", updatedAt: at },
      [turbo.id]: { provider: "ONVISTA", symbol: turbo.isin, origin: "AUTO", updatedAt: at },
      [btc.id]: { provider: "COINGECKO", symbol: "bitcoin", origin: "AUTO", updatedAt: at },
    });

    // One batched OpenFIGI request without the certificate, carrying only ISINs and GY.
    const figi = calls.filter((call) => call.url.includes("openfigi"));
    expect(figi).toHaveLength(1);
    expect(JSON.parse(figi[0].body!).map((job: { idValue: string }) => job.idValue).sort()).toEqual([SAP, MSCI_WORLD, XTRACKERS].sort());
    expect(calls.filter((call) => call.url.includes("coingecko")).map((call) => call.url)).toEqual([
      "https://api.coingecko.com/api/v3/search?query=BTC",
    ]);
    expect(search.mock.calls.map(([isin]) => isin).sort()).toEqual([MSCI_WORLD, XTRACKERS].sort());

    // A second run makes no provider call: every Security has a row.
    const again = providers();
    expect(await resolveMissingMappings(again.deps, db())).toEqual({ mapped: 0, notFound: 0, failed: [] });
    expect(again.calls).toEqual([]);
    expect(again.search).not.toHaveBeenCalled();
  });

  it("falls back to Yahoo while OpenFIGI is down and writes no row when both fail", async () => {
    const xtrackers = await security({ isin: XTRACKERS }, "Xtrackers MSCI World", "ETF");
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    const sap = await security({ isin: SAP }, "SAP", "STOCK");
    const { deps } = providers({
      openfigi: () => new Response("Too Many Requests", { status: 429 }),
      yahoo: {
        [XTRACKERS]: recorded("yahoo-search-xtrackers-msci-world"),
        [MSCI_WORLD]: recorded("yahoo-search-ishares-core-msci-world"),
        [SAP]: new Error("timeout"),
      },
    });

    const result = await resolveMissingMappings(deps, db());

    expect(result).toEqual({
      mapped: 1,
      notFound: 0,
      failed: [
        { securityId: msci.id, name: "iShares Core MSCI World" },
        { securityId: sap.id, name: "SAP" },
      ],
    });
    expect(await rows()).toEqual([expect.objectContaining({ securityId: xtrackers.id, provider: "YAHOO", symbol: "DBXW.DE" })]);
  });

  it("writes no row for a crypto Security when CoinGecko fails, and a marker when nothing matches", async () => {
    const btc = await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    const failing = providers({ coingecko: () => new TypeError("fetch failed") });
    expect(await resolveMissingMappings(failing.deps, db())).toEqual({
      mapped: 0,
      notFound: 0,
      failed: [{ securityId: btc.id, name: "Bitcoin" }],
    });
    expect(await rows()).toEqual([]);

    expect(await resolveMissingMappings(providers().deps, db())).toEqual({ mapped: 0, notFound: 1, failed: [] });
    expect(await rows()).toEqual([expect.objectContaining({ securityId: btc.id, provider: null, symbol: null })]);
  });

  it("never overwrites an existing row (manual mapping or marker) and asks no provider for it", async () => {
    const sap = await security({ isin: SAP }, "SAP", "STOCK");
    await setMapping(sap.id, { provider: "YAHOO", symbol: "SAP.F" }, db());
    const { deps, calls, search } = providers({ openfigi: () => json(recorded("openfigi-mapping-sap-msci-world-apple")) });
    expect(await resolveMissingMappings(deps, db())).toEqual({ mapped: 0, notFound: 0, failed: [] });
    expect(calls).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    expect(await rows()).toEqual([expect.objectContaining({ provider: "YAHOO", symbol: "SAP.F", origin: "MANUAL" })]);
  });

  it("sends the OpenFIGI and CoinGecko keys from env only when set", async () => {
    await security({ isin: SAP }, "SAP", "STOCK");
    await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    const { deps, calls } = providers();
    await resolveMissingMappings({ ...deps, env: { OPENFIGI_API_KEY: "figi-key", COINGECKO_API_KEY: "cg-key" } }, db());
    const figi = calls.find((call) => call.url.includes("openfigi"))!;
    const gecko = calls.find((call) => call.url.includes("coingecko"))!;
    expect(figi.headers["x-openfigi-apikey"]).toBe("figi-key");
    expect(gecko.headers["x-cg-demo-api-key"]).toBe("cg-key");

    await db().providerMapping.deleteMany();
    const empty = providers();
    await resolveMissingMappings({ ...empty.deps, env: { OPENFIGI_API_KEY: " ", COINGECKO_API_KEY: "" } }, db());
    for (const call of empty.calls) {
      expect(Object.keys(call.headers)).not.toContain("x-openfigi-apikey");
      expect(Object.keys(call.headers)).not.toContain("x-cg-demo-api-key");
    }
  });

  it("skips a Security whose row was created concurrently", async () => {
    const sap = await security({ isin: SAP }, "SAP", "STOCK");
    const real = db();
    // Another request stores a manual mapping right before this run inserts its row.
    const providerMapping = new Proxy(real.providerMapping, {
      get: (target, prop, receiver) =>
        prop === "create"
          ? async (args: Parameters<typeof real.providerMapping.create>[0]) => {
              await target.create({
                data: { securityId: sap.id, provider: "YAHOO", symbol: "SAP.F", origin: "MANUAL", updatedAt: NOW.toISOString() },
              });
              return target.create(args);
            }
          : Reflect.get(target, prop, receiver),
    });
    const raceDb = new Proxy(real, {
      get: (target, prop, receiver) => (prop === "providerMapping" ? providerMapping : Reflect.get(target, prop, receiver)),
    });
    const { deps } = providers({ openfigi: () => json((recorded("openfigi-mapping-sap-msci-world-apple") as unknown[]).slice(0, 1)) });
    expect(await resolveMissingMappings(deps, raceDb)).toEqual({ mapped: 0, notFound: 0, failed: [] });
    expect(await rows()).toEqual([expect.objectContaining({ symbol: "SAP.F", origin: "MANUAL" })]);
  });
});

describe("resolveMappingFor", () => {
  it("replaces a not-found marker when a source is found now", async () => {
    const xtrackers = await security({ isin: XTRACKERS }, "Xtrackers MSCI World", "ETF");
    await resolveMissingMappings(providers().deps, db());
    expect(await rows()).toEqual([expect.objectContaining({ provider: null })]);

    const { deps } = providers({ yahoo: { [XTRACKERS]: recorded("yahoo-search-xtrackers-msci-world") } });
    expect(await resolveMappingFor(xtrackers.id, deps, db())).toEqual({ ok: true, status: "mapped" });
    expect(await rows()).toEqual([
      expect.objectContaining({ securityId: xtrackers.id, provider: "YAHOO", symbol: "DBXW.DE", origin: "AUTO" }),
    ]);
  });

  it("creates the row for a Security without one and keeps the marker on another miss", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    expect(await resolveMappingFor(msci.id, providers().deps, db())).toEqual({ ok: true, status: "not-found" });
    expect(await resolveMappingFor(msci.id, providers().deps, db())).toEqual({ ok: true, status: "not-found" });
    expect(await rows()).toEqual([expect.objectContaining({ provider: null, symbol: null, origin: "AUTO" })]);
  });

  it("writes nothing on a transient failure", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    const { deps } = providers({ openfigi: () => json({}, 503), yahoo: { [MSCI_WORLD]: new Error("down") } });
    expect(await resolveMappingFor(msci.id, deps, db())).toEqual({ ok: false, reason: "provider-failed" });
    expect(await rows()).toEqual([]);
  });

  /** `db()` whose providerMapping `method` first stores a MANUAL mapping (another request racing this one). */
  function racingDb(method: "updateMany" | "create", securityId: string) {
    const real = db();
    const manual = { provider: "YAHOO" as const, symbol: "EUNL.DE", origin: "MANUAL" as const, updatedAt: NOW.toISOString() };
    const providerMapping = new Proxy(real.providerMapping, {
      get: (target, prop, receiver) =>
        prop === method
          ? async (args: never) => {
              await target.upsert({ where: { securityId }, create: { securityId, ...manual }, update: manual });
              return (target[method] as (args: never) => Promise<unknown>)(args);
            }
          : Reflect.get(target, prop, receiver),
    });
    return new Proxy(real, {
      get: (target, prop, receiver) => (prop === "providerMapping" ? providerMapping : Reflect.get(target, prop, receiver)),
    });
  }

  it("returns already-mapped when a mapping replaces the marker meanwhile", async () => {
    const xtrackers = await security({ isin: XTRACKERS }, "Xtrackers MSCI World", "ETF");
    await resolveMissingMappings(providers().deps, db());
    const { deps } = providers({ yahoo: { [XTRACKERS]: recorded("yahoo-search-xtrackers-msci-world") } });
    expect(await resolveMappingFor(xtrackers.id, deps, racingDb("updateMany", xtrackers.id))).toEqual({
      ok: false,
      reason: "already-mapped",
    });
    expect(await rows()).toEqual([expect.objectContaining({ provider: "YAHOO", symbol: "EUNL.DE", origin: "MANUAL" })]);
  });

  it("returns already-mapped when a row is created meanwhile (unique violation)", async () => {
    const xtrackers = await security({ isin: XTRACKERS }, "Xtrackers MSCI World", "ETF");
    const { deps } = providers({ yahoo: { [XTRACKERS]: recorded("yahoo-search-xtrackers-msci-world") } });
    expect(await resolveMappingFor(xtrackers.id, deps, racingDb("create", xtrackers.id))).toEqual({
      ok: false,
      reason: "already-mapped",
    });
    expect(await rows()).toEqual([expect.objectContaining({ provider: "YAHOO", symbol: "EUNL.DE", origin: "MANUAL" })]);
  });

  it("refuses to touch a mapped row and reports unknown Securities", async () => {
    const sap = await security({ isin: SAP }, "SAP", "STOCK");
    await setMapping(sap.id, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    const { deps, calls } = providers();
    expect(await resolveMappingFor(sap.id, deps, db())).toEqual({ ok: false, reason: "already-mapped" });
    expect(await resolveMappingFor("missing", deps, db())).toEqual({ ok: false, reason: "not-found" });
    expect(calls).toEqual([]);
  });
});

describe("setMapping", () => {
  it("upserts exactly one MANUAL row, replacing an AUTO one", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    await resolveMissingMappings(providers().deps, db());
    expect(await setMapping(msci.id, { provider: "YAHOO", symbol: " EUNL.DE " }, db())).toEqual({
      ok: true,
      mapping: { provider: "YAHOO", symbol: "EUNL.DE", origin: "MANUAL" },
    });
    expect(await rows()).toEqual([
      expect.objectContaining({ securityId: msci.id, provider: "YAHOO", symbol: "EUNL.DE", origin: "MANUAL" }),
    ]);
  });

  it.each([
    [{ provider: "STOOQ", symbol: "EUNL.DE" }, "provider-invalid"],
    [{ provider: "", symbol: "EUNL.DE" }, "provider-invalid"],
    [{ provider: "YAHOO", symbol: "  " }, "symbol-invalid"],
    [{ provider: "YAHOO", symbol: "EUNL DE" }, "symbol-invalid"],
    [{ provider: "YAHOO", symbol: "x".repeat(41) }, "symbol-invalid"],
    [{ provider: "YAHOO", symbol: 42 }, "symbol-invalid"],
  ])("rejects %j with %s and writes nothing", async (input, reason) => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    expect(await setMapping(msci.id, input, db())).toEqual({ ok: false, reason });
    expect(await rows()).toEqual([]);
  });

  it("accepts 40-character symbols and CoinGecko ids", async () => {
    const btc = await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    expect((await setMapping(btc.id, { provider: "COINGECKO", symbol: "bitcoin" }, db())).ok).toBe(true);
    expect((await setMapping(btc.id, { provider: "COINGECKO", symbol: "b".repeat(40) }, db())).ok).toBe(true);
  });

  it("returns not-found for an unknown Security", async () => {
    expect(await setMapping("missing", { provider: "YAHOO", symbol: "SAP.DE" }, db())).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("listSecuritiesWithMappings", () => {
  it("joins every Security (sorted by name) with its row or null", async () => {
    const sap = await security({ isin: SAP }, "SAP", "STOCK");
    const btc = await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    await setMapping(sap.id, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    expect(await listSecuritiesWithMappings(db())).toEqual([
      { ...btc, mapping: null },
      { ...sap, mapping: { provider: "YAHOO", symbol: "SAP.DE", origin: "MANUAL" } },
    ]);
  });

  it("deletes the mapping with its Security (cascade)", async () => {
    const sap = await security({ isin: SAP }, "SAP", "STOCK");
    await setMapping(sap.id, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    await db().security.delete({ where: { id: sap.id } });
    expect(await rows()).toEqual([]);
  });
});
