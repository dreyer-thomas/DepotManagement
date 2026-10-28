import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorded } from "../../../test/helpers/providers";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { changeSecurityType, createDepot, ensureSecurity, recordTrade } from "@/modules/ledger";
import { setMapping } from "@/modules/prices";
import {
  type ClassificationDeps,
  exportClassifications,
  listAnalystSymbols,
  listClassifications,
  listKeyFigures,
  listRegionSplits,
  refreshClassifications,
  refreshKeyFigures,
  replaceAllClassifications,
  setAnalystSymbol,
  setManualClassification,
  setManualRegionSplit,
} from "./index";
import type { YahooQuoteSummary, YahooSearch } from "./providers/yahoo";

let testDb: TestDatabase;

beforeEach(() => {
  testDb = createTestDatabase();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.cleanup();
});

const db = () => testDb.client;
const NOW = new Date("2026-10-27T10:00:00.000Z");

async function security(identifier: { isin: string } | { cryptoSymbol: string }, name: string, assetType: string) {
  const result = await ensureSecurity(identifier, { name, assetType }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.security.id;
}

async function mapYahoo(securityId: string, symbol: string) {
  const result = await setMapping(securityId, { provider: "YAHOO", symbol }, db());
  if (!result.ok) throw new Error("setup failed");
}

/** A fake quoteSummary answering per symbol (an Error rejects); records the symbols asked for. */
function yahoo(replies: Record<string, unknown>) {
  const symbols: string[] = [];
  const quoteSummary: YahooQuoteSummary = async (symbol) => {
    symbols.push(symbol);
    const reply = replies[symbol];
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new Error(`Quote not found for symbol: ${symbol}`);
    return reply;
  };
  return { quoteSummary, symbols };
}

const deps = (quoteSummary: YahooQuoteSummary): ClassificationDeps => ({ quoteSummary, now: () => NOW });
const SAP_PROFILE = recorded("yahoo-quotesummary-sap-de");

/** Effective value per dimension as "value (source)" for compact assertions. */
async function summary(securityId: string) {
  const classification = (await listClassifications(db()))[securityId];
  return {
    type: classification.type,
    assetClass: classification.assetClass.value && `${classification.assetClass.value} (${classification.assetClass.source})`,
    sector: classification.sector.value && `${classification.sector.value} (${classification.sector.source})`,
    industry: classification.industry.value && `${classification.industry.value} (${classification.industry.source})`,
    region: classification.region.value && `${classification.region.value} (${classification.region.source})`,
    country: classification.country.value && `${classification.country.value} (${classification.country.source})`,
    companySize: classification.companySize.value && `${classification.companySize.value} (${classification.companySize.source})`,
    currency: classification.currency.value && `${classification.currency.value} (${classification.currency.source})`,
  };
}

describe("refreshClassifications", () => {
  it("classifies a stock via Yahoo (asking only its symbol) and ETFs, crypto and funds by rules", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    const msci = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF USD (Acc)", "ETF");
    const btc = await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    const dws = await security({ isin: "DE0008476524" }, "DWS Vermögensbildungsfonds I", "FUND");
    await mapYahoo(sap, "SAP.DE");
    await mapYahoo(msci, "EUNL.DE");
    const { quoteSummary, symbols } = yahoo({ "SAP.DE": SAP_PROFILE });

    expect(await refreshClassifications(deps(quoteSummary), db())).toEqual({ updated: 4, unchanged: 0, failed: 0 });
    // Only the STOCK with a Yahoo mapping is fetched.
    expect(symbols).toEqual(["SAP.DE"]);
    expect(await summary(sap)).toEqual({
      type: "STOCK",
      assetClass: "Aktien (rule)",
      sector: "Technologie (provider)",
      industry: "Software—Application (provider)",
      region: "Europa (provider)",
      country: "Deutschland (provider)",
      companySize: "Large Cap (provider)",
      currency: "EUR (provider)",
    });
    expect(await summary(msci)).toEqual({
      type: "ETF",
      assetClass: "Aktien (rule)",
      sector: null,
      industry: null,
      region: "Welt (rule)",
      country: null,
      companySize: "– (rule)",
      currency: "USD (rule)",
    });
    expect(await summary(btc)).toMatchObject({ assetClass: "Krypto (rule)", companySize: "– (rule)", region: null, currency: null });
    expect(await summary(dws)).toMatchObject({ assetClass: null, region: null });
    const row = await db().securityClassification.findUnique({ where: { securityId: sap } });
    expect(row).toMatchObject({ providerSymbol: "SAP.DE", providerFetchedAt: NOW.toISOString(), updatedAt: NOW.toISOString() });

    // A second run writes nothing and asks no provider again.
    const again = yahoo({ "SAP.DE": SAP_PROFILE });
    expect(await refreshClassifications(deps(again.quoteSummary), db())).toEqual({ updated: 0, unchanged: 4, failed: 0 });
    expect(again.symbols).toEqual([]);
  });

  it("stores rule values on a transient provider error and retries the provider next run", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    const failing = yahoo({ "SAP.DE": new TypeError("fetch failed") });
    expect(await refreshClassifications(deps(failing.quoteSummary), db())).toEqual({ updated: 1, unchanged: 0, failed: 1 });
    expect(await db().securityClassification.findUnique({ where: { securityId: sap } })).toMatchObject({
      assetClass: "Aktien",
      assetClassSource: "RULE",
      sector: null,
      providerSymbol: null,
    });

    const working = yahoo({ "SAP.DE": SAP_PROFILE });
    expect(await refreshClassifications(deps(working.quoteSummary), db())).toMatchObject({ updated: 1, failed: 0 });
    expect(working.symbols).toEqual(["SAP.DE"]);
    expect((await summary(sap)).sector).toBe("Technologie (provider)");
  });

  it("records a 'no data' answer and does not ask again until the symbol changes", async () => {
    const id = await security({ isin: "US0378331005" }, "Apple Inc.", "STOCK");
    await mapYahoo(id, "APC.DE");
    const empty = yahoo({ "APC.DE": recorded("yahoo-quotesummary-no-profile") });
    await refreshClassifications(deps(empty.quoteSummary), db());
    expect(await db().securityClassification.findUnique({ where: { securityId: id } })).toMatchObject({
      assetClass: "Aktien",
      sector: null,
      providerSymbol: "APC.DE",
    });
    const again = yahoo({});
    await refreshClassifications(deps(again.quoteSummary), db());
    expect(again.symbols).toEqual([]);

    await mapYahoo(id, "APC.F");
    const changed = yahoo({ "APC.F": SAP_PROFILE });
    await refreshClassifications(deps(changed.quoteSummary), db());
    expect(changed.symbols).toEqual(["APC.F"]);
  });

  it("replaces old provider values with rule values when a new symbol answers 'no data'", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    await refreshClassifications(deps(yahoo({ "SAP.DE": SAP_PROFILE }).quoteSummary), db());
    expect((await summary(sap)).sector).toBe("Technologie (provider)");

    await mapYahoo(sap, "SAP.F");
    const { quoteSummary, symbols } = yahoo({ "SAP.F": recorded("yahoo-quotesummary-no-profile") });
    await refreshClassifications(deps(quoteSummary), db());
    expect(symbols).toEqual(["SAP.F"]);
    expect(await summary(sap)).toEqual({
      type: "STOCK",
      assetClass: "Aktien (rule)",
      sector: null,
      industry: null,
      region: null,
      country: null,
      companySize: null,
      currency: null,
    });
    expect(await db().securityClassification.findUnique({ where: { securityId: sap } })).toMatchObject({ providerSymbol: "SAP.F" });
  });

  it("refetches the provider after STOCK → ETF → STOCK with an unchanged symbol", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    await refreshClassifications(deps(yahoo({ "SAP.DE": SAP_PROFILE }).quoteSummary), db());

    await changeSecurityType(sap, "ETF", db());
    await refreshClassifications(deps(yahoo({ "SAP.DE": SAP_PROFILE }).quoteSummary), db());
    expect(await db().securityClassification.findUnique({ where: { securityId: sap } })).toMatchObject({
      sector: null,
      providerSymbol: null,
      providerFetchedAt: null,
    });

    await changeSecurityType(sap, "STOCK", db());
    const { quoteSummary, symbols } = yahoo({ "SAP.DE": SAP_PROFILE });
    await refreshClassifications(deps(quoteSummary), db());
    expect(symbols).toEqual(["SAP.DE"]);
    expect((await summary(sap)).sector).toBe("Technologie (provider)");
  });

  it("serializes concurrent runs", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = vi.fn<YahooQuoteSummary>(async () => {
      await gate;
      throw new TypeError("fetch failed");
    });
    const second = vi.fn<YahooQuoteSummary>(async () => SAP_PROFILE);
    const running = refreshClassifications(deps(first), db());
    const queued = refreshClassifications(deps(second), db());
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(second).not.toHaveBeenCalled();
    release();
    expect(await running).toMatchObject({ failed: 1 });
    expect(await queued).toMatchObject({ failed: 0 });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("gives certificates the underlying's effective values, else Derivate / Rohstoffe", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    const turbo = await security({ isin: "DE000SYN0013" }, "Turbo Long auf SAP SE", "CERTIFICATE");
    const dax = await security({ isin: "DE000SYN0021" }, "Mini Future Long DAX", "CERTIFICATE");
    const gold = await security({ isin: "DE000SYN0039" }, "Xetra-Gold ETC", "CERTIFICATE");
    await mapYahoo(sap, "SAP.DE");
    await setManualClassification(sap, { sector: "Halbleiter" }, db());
    const { quoteSummary, symbols } = yahoo({ "SAP.DE": SAP_PROFILE });

    await refreshClassifications(deps(quoteSummary), db());

    expect(symbols).toEqual(["SAP.DE"]);
    expect(await summary(turbo)).toEqual({
      type: "CERTIFICATE",
      assetClass: "Aktien (rule)",
      sector: "Halbleiter (rule)",
      industry: "Software—Application (rule)",
      region: "Europa (rule)",
      country: "Deutschland (rule)",
      companySize: "Large Cap (rule)",
      currency: "EUR (rule)",
    });
    expect(await summary(dax)).toMatchObject({ assetClass: "Derivate (rule)", region: null });
    expect(await summary(gold)).toMatchObject({ assetClass: "Rohstoffe (rule)" });
  });

  it("never overwrites a manual value; the automatic value is updated underneath", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    expect(await setManualClassification(sap, { sector: "Halbleiter" }, db())).toMatchObject({ ok: true });

    await refreshClassifications(deps(yahoo({ "SAP.DE": SAP_PROFILE }).quoteSummary), db());

    const classification = (await listClassifications(db()))[sap];
    expect(classification.sector).toEqual({
      value: "Halbleiter",
      source: "manual",
      manual: "Halbleiter",
      automatic: { value: "Technologie", source: "provider" },
    });
    // "Automatisch" restores the automatic value.
    expect(await setManualClassification(sap, { sector: "" }, db())).toMatchObject({
      ok: true,
      classification: { sector: { value: "Technologie", source: "provider", manual: null } },
    });
  });

  it("picks up an asset type change through the rules", async () => {
    const id = await security({ isin: "IE00B5BMR087" }, "Vanguard S&P 500", "STOCK");
    await refreshClassifications(deps(yahoo({}).quoteSummary), db());
    expect((await summary(id)).assetClass).toBe("Aktien (rule)");
    await changeSecurityType(id, "ETF", db());
    await refreshClassifications(deps(yahoo({}).quoteSummary), db());
    expect(await summary(id)).toMatchObject({ type: "ETF", region: "USA (rule)", country: "USA (rule)", companySize: "– (rule)" });
  });
});

describe("listClassifications", () => {
  it("lists every Security; a Security without row is all unknown", async () => {
    const id = await security({ cryptoSymbol: "ETH" }, "Ethereum", "CRYPTO");
    const classifications = await listClassifications(db());
    expect(Object.keys(classifications)).toEqual([id]);
    expect(classifications[id].type).toBe("CRYPTO");
    expect(classifications[id].assetClass).toEqual({ value: null, source: null, manual: null, automatic: { value: null, source: null } });
  });
});

describe("setManualClassification", () => {
  it("validates every dimension before writing", async () => {
    const id = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    expect(await setManualClassification(id, { sector: "Halbleiter", region: "Mars" }, db())).toEqual({ ok: false, reason: "region-invalid" });
    expect(await setManualClassification(id, { currency: "eur1" }, db())).toEqual({ ok: false, reason: "currency-invalid" });
    expect(await setManualClassification(id, { assetClass: "Aktie" }, db())).toEqual({ ok: false, reason: "asset-class-invalid" });
    expect(await setManualClassification(id, { companySize: "Mega Cap" }, db())).toEqual({ ok: false, reason: "company-size-invalid" });
    expect(await setManualClassification(id, { industry: "x".repeat(81) }, db())).toEqual({ ok: false, reason: "industry-invalid" });
    expect(await setManualClassification(id, { country: 5 }, db())).toEqual({ ok: false, reason: "country-invalid" });
    expect(await db().securityClassification.count()).toBe(0);
    expect(await setManualClassification("missing", { sector: "x" }, db())).toEqual({ ok: false, reason: "not-found" });
  });

  it("stores normalised values, clears with an empty string and leaves absent keys unchanged", async () => {
    const id = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await setManualClassification(id, { currency: " usd ", region: "USA", country: "  USA " }, db());
    await setManualClassification(id, { region: "" }, db());
    const row = await db().securityClassification.findUnique({ where: { securityId: id } });
    expect(row).toMatchObject({ currencyManual: "USD", regionManual: null, countryManual: "USA", assetClass: null });
  });
});

describe("exportClassifications / replaceAllClassifications", () => {
  it("round-trips manual overrides only; restored rows are completed by the next refresh", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    const btc = await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    await mapYahoo(sap, "SAP.DE");
    await refreshClassifications(deps(yahoo({ "SAP.DE": SAP_PROFILE }).quoteSummary), db());
    await setManualClassification(sap, { sector: "Halbleiter", currency: "USD" }, db());

    const exported = await exportClassifications(db());
    expect(exported).toEqual([
      {
        id: expect.any(String),
        securityId: sap,
        assetClass: null,
        sector: "Halbleiter",
        industry: null,
        region: null,
        country: null,
        companySize: null,
        currency: "USD",
        regionSplit: null,
      },
    ]);

    await replaceAllClassifications(exported, db(), () => NOW);
    expect(await exportClassifications(db())).toEqual(exported);
    expect(await db().securityClassification.findUnique({ where: { securityId: btc } })).toBeNull();
    expect(await db().securityClassification.findUnique({ where: { securityId: sap } })).toMatchObject({
      sector: null,
      providerSymbol: null,
      updatedAt: NOW.toISOString(),
    });

    const { quoteSummary, symbols } = yahoo({ "SAP.DE": SAP_PROFILE });
    await refreshClassifications(deps(quoteSummary), db());
    expect(symbols).toEqual(["SAP.DE"]);
    expect((await summary(sap)).sector).toBe("Halbleiter (manual)");
    expect((await summary(sap)).industry).toBe("Software—Application (provider)");
  });
});

const WORLD_WEIGHTS = [
  { region: "USA", weight: "72" },
  { region: "Europa", weight: "15" },
  { region: "Japan", weight: "6" },
  { region: "Pazifik ohne Japan", weight: "4" },
  { region: "Sonstige", weight: "3" },
];
const MANUAL_WEIGHTS = [
  { region: "USA", weight: "60" },
  { region: "Europa", weight: "40" },
];

describe("region splits", () => {
  it("stores the rule split of ETFs/funds only and counts a split change as an update", async () => {
    const world = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF", "ETF");
    const bond = await security({ isin: "IE00B3F81409" }, "iShares Core Global Aggregate Bond UCITS ETF", "ETF");
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await refreshClassifications(deps(yahoo({}).quoteSummary), db());

    const splits = await listRegionSplits(db());
    expect(splits[world]).toEqual({
      effective: { weights: WORLD_WEIGHTS, source: "rule", index: "MSCI World", asOf: "2026-09-30" },
      manual: null,
      rule: { weights: WORLD_WEIGHTS, index: "MSCI World", asOf: "2026-09-30" },
    });
    expect(splits[bond]).toEqual({ effective: null, manual: null, rule: null });
    expect(splits[sap]).toEqual({ effective: null, manual: null, rule: null });
    expect(await db().securityClassification.findUnique({ where: { securityId: world } })).toMatchObject({
      regionSplit: '{"USA":"72","Europa":"15","Japan":"6","Pazifik ohne Japan":"4","Sonstige":"3"}',
      regionSplitSource: "RULE",
      regionSplitAsOf: "2026-09-30",
      regionSplitIndex: "MSCI World",
      regionSplitManual: null,
    });

    // Unchanged on the next run; a stale split (e.g. older table) is rewritten and counted.
    expect(await refreshClassifications(deps(yahoo({}).quoteSummary), db())).toEqual({ updated: 0, unchanged: 3, failed: 0 });
    await db().securityClassification.update({ where: { securityId: world }, data: { regionSplitAsOf: "2025-12-31" } });
    expect(await refreshClassifications(deps(yahoo({}).quoteSummary), db())).toEqual({ updated: 1, unchanged: 2, failed: 0 });
    expect((await listRegionSplits(db()))[world].rule?.asOf).toBe("2026-09-30");

    // A type change away from ETF clears the rule split.
    await changeSecurityType(world, "STOCK", db());
    await refreshClassifications(deps(yahoo({}).quoteSummary), db());
    expect(await db().securityClassification.findUnique({ where: { securityId: world } })).toMatchObject({
      regionSplit: null,
      regionSplitSource: null,
      regionSplitAsOf: null,
      regionSplitIndex: null,
    });
  });

  it("lets a manual split win over the rule, keeps it across refreshes and clears it with all fields empty", async () => {
    const world = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF", "ETF");
    await refreshClassifications(deps(yahoo({}).quoteSummary), db());
    expect(await setManualRegionSplit(world, { USA: "60", Europa: "40" }, db())).toEqual({ ok: true, manual: MANUAL_WEIGHTS });

    await refreshClassifications(deps(yahoo({}).quoteSummary), db());
    expect((await listRegionSplits(db()))[world]).toEqual({
      effective: { weights: MANUAL_WEIGHTS, source: "manual", index: null, asOf: null },
      manual: MANUAL_WEIGHTS,
      rule: { weights: WORLD_WEIGHTS, index: "MSCI World", asOf: "2026-09-30" },
    });

    expect(await setManualRegionSplit(world, { USA: "", Europa: "" }, db())).toEqual({ ok: true, manual: null });
    expect((await listRegionSplits(db()))[world].effective?.source).toBe("rule");
  });

  it("has no effective split when the region dimension has a manual value", async () => {
    const world = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF", "ETF");
    await refreshClassifications(deps(yahoo({}).quoteSummary), db());
    await setManualClassification(world, { region: "Europa" }, db());
    const split = (await listRegionSplits(db()))[world];
    expect(split.effective).toBeNull();
    expect(split.rule?.index).toBe("MSCI World");
  });

  it("validates before writing", async () => {
    const world = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF", "ETF");
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    expect(await setManualRegionSplit("missing", { USA: "100" }, db())).toEqual({ ok: false, reason: "not-found" });
    expect(await setManualRegionSplit(sap, { USA: "100" }, db())).toEqual({ ok: false, reason: "not-a-fund" });
    expect(await setManualRegionSplit(world, { USA: "60", Europa: "39,5" }, db())).toEqual({ ok: false, reason: "split-sum" });
    expect(await setManualRegionSplit(world, { USA: "-1", Europa: "101" }, db())).toEqual({ ok: false, reason: "split-invalid" });
    expect(await setManualRegionSplit(world, { USA: "99,995", Europa: "0,005" }, db())).toEqual({ ok: false, reason: "split-invalid" });
    expect(await db().securityClassification.count()).toBe(0);
  });

  it("exports and restores a manual split (also on a row without other overrides); the rule split is not exported", async () => {
    const world = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF", "ETF");
    await refreshClassifications(deps(yahoo({}).quoteSummary), db());
    expect(await exportClassifications(db())).toEqual([]);
    await setManualRegionSplit(world, { USA: "60", Europa: "40" }, db());

    const exported = await exportClassifications(db());
    expect(exported).toEqual([
      {
        id: expect.any(String),
        securityId: world,
        assetClass: null,
        sector: null,
        industry: null,
        region: null,
        country: null,
        companySize: null,
        currency: null,
        regionSplit: { USA: "60", Europa: "40" },
      },
    ]);

    await replaceAllClassifications(exported, db(), () => NOW);
    expect(await exportClassifications(db())).toEqual(exported);
    expect(await db().securityClassification.findUnique({ where: { securityId: world } })).toMatchObject({
      regionSplit: null,
      regionSplitManual: '{"USA":"60","Europa":"40"}',
    });
    await refreshClassifications(deps(yahoo({}).quoteSummary), db());
    expect((await listRegionSplits(db()))[world]).toMatchObject({ effective: { source: "manual" }, rule: { index: "MSCI World" } });
  });
});

describe("key figures (story 9.6)", () => {
  const SAP_FIGURES = recorded("yahoo-quotesummary-keyfigures-sap-de") as Record<string, unknown>;
  const EUNL_FIGURES = recorded("yahoo-quotesummary-keyfigures-eunl-de");
  const SAP_FULL = { ...(SAP_PROFILE as Record<string, unknown>), ...SAP_FIGURES };
  const KEY_FIGURE_MODULES = ["summaryDetail", "defaultKeyStatistics", "financialData", "calendarEvents", "fundProfile"];
  const ANALYST_EXTRA = ["recommendationTrend", "upgradeDowngradeHistory"];
  /** Profile + key figures + analyst modules of a stock whose Analysten-Symbol is its mapping symbol. */
  const ALL_MODULES = ["assetProfile", "price", ...KEY_FIGURE_MODULES, ...ANALYST_EXTRA];
  /** Key figures + analyst modules in one request. */
  const STOCK_MODULES = [...KEY_FIGURE_MODULES, "price", ...ANALYST_EXTRA];

  /** A fake quoteSummary recording symbol and modules per call. */
  function recording(replies: Record<string, unknown>) {
    const calls: { symbol: string; modules: string[] }[] = [];
    const quoteSummary: YahooQuoteSummary = async (symbol, query) => {
      calls.push({ symbol, modules: [...query.modules] });
      const reply = replies[symbol];
      if (reply instanceof Error) throw reply;
      if (reply === undefined) throw new Error(`Quote not found for symbol: ${symbol}`);
      return reply;
    };
    return { quoteSummary, calls };
  }

  let depotId: string;
  beforeEach(async () => {
    const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
    if (!depot.ok) throw new Error("setup failed");
    depotId = depot.depot.id;
  });

  async function hold(securityId: string) {
    const trade = await recordTrade({ depotId, type: "BUY", date: "2026-10-01", quantity: "1", price: "100", security: { id: securityId } }, db());
    if (!trade.ok) throw new Error("setup failed");
  }

  /** Yahoo search without any home listing: the Analysten-Symbol falls back to the mapping symbol. */
  const NO_HOME_LISTING: YahooSearch = async () => ({ quotes: [] });

  const at = (
    iso: string,
    watched: readonly string[] = [],
    quoteSummary?: YahooQuoteSummary,
    search: YahooSearch = NO_HOME_LISTING,
  ): ClassificationDeps => ({
    quoteSummary,
    search,
    now: () => new Date(iso),
    watched: async () => watched,
  });

  it("shares one request with the pending profile and stores the snapshot; a second run the same day asks nothing", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    await hold(sap);
    const { quoteSummary, calls } = recording({ "SAP.DE": SAP_FULL });

    expect(await refreshClassifications(at("2026-10-28T10:00:00.000Z", [], quoteSummary), db())).toMatchObject({ failed: 0 });
    expect(calls).toEqual([{ symbol: "SAP.DE", modules: ALL_MODULES }]);
    expect((await summary(sap)).sector).toBe("Technologie (provider)");
    const info = (await listKeyFigures([sap], "2026-10-28", db()))[sap];
    expect(info).toMatchObject({
      refreshable: true,
      snapshot: { symbol: "SAP.DE", asOf: "2026-10-28", stale: false, fetchedToday: true, fetchedAt: "2026-10-28T10:00:00.000Z" },
    });
    expect(info.snapshot?.figures).toMatchObject({ trailingPE: "30.4321", dividendYield: "0.0118", marketCap: "243770000000", marketCapCurrency: "EUR" });

    const again = recording({ "SAP.DE": SAP_FULL });
    await refreshClassifications(at("2026-10-28T21:00:00.000Z", [], again.quoteSummary), db());
    expect(again.calls).toEqual([]);
    expect(await refreshKeyFigures(sap, at("2026-10-28T21:30:00.000Z", [], again.quoteSummary), db())).toEqual({ status: "fresh" });
    expect(again.calls).toEqual([]);

    // The next Berlin day: key figures only (the profile is answered already).
    const nextDay = recording({ "SAP.DE": SAP_FIGURES });
    await refreshClassifications(at("2026-10-28T23:30:00.000Z", [], nextDay.quoteSummary), db());
    expect(nextDay.calls).toEqual([{ symbol: "SAP.DE", modules: STOCK_MODULES }]);
    expect((await listKeyFigures([sap], "2026-10-29", db()))[sap].snapshot).toMatchObject({ asOf: "2026-10-29" });
  });

  it("a classification-only fetch keeps its exact query; a watched ETF gets key figures only", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    const msci = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF USD (Acc)", "ETF");
    await mapYahoo(sap, "SAP.DE");
    await mapYahoo(msci, "EUNL.DE");
    const { quoteSummary, calls } = recording({ "SAP.DE": SAP_PROFILE, "EUNL.DE": EUNL_FIGURES });

    await refreshClassifications(at("2026-10-28T10:00:00.000Z", [msci], quoteSummary), db());
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(
      expect.arrayContaining([
        { symbol: "SAP.DE", modules: ["assetProfile", "price"] },
        { symbol: "EUNL.DE", modules: KEY_FIGURE_MODULES },
      ]),
    );
    const figures = await listKeyFigures([sap, msci], "2026-10-28", db());
    expect(figures[sap]).toEqual({ snapshot: null, refreshable: true });
    expect(figures[msci].snapshot?.figures).toMatchObject({ fundFamily: "iShares", expenseRatio: "0.002", inceptionDate: "2009-09-25", trailingPE: null });
  });

  it("never asks for crypto, certificates or unmapped Securities", async () => {
    const btc = await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    const turbo = await security({ isin: "DE000SYN0013" }, "Turbo Long auf SAP SE", "CERTIFICATE");
    const unmapped = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(btc, "BTC-EUR");
    await mapYahoo(turbo, "TURBO.DE");
    const { quoteSummary, calls } = recording({});
    await refreshClassifications(at("2026-10-28T10:00:00.000Z", [btc, turbo, unmapped], quoteSummary), db());
    expect(calls).toEqual([]);
    expect(await refreshKeyFigures(btc, at("2026-10-28T10:00:00.000Z", [btc], quoteSummary), db())).toEqual({ status: "unavailable" });
    expect(await refreshKeyFigures(unmapped, at("2026-10-28T10:00:00.000Z", [unmapped], quoteSummary), db())).toEqual({ status: "unavailable" });
    expect(calls).toEqual([]);
    expect((await listKeyFigures([btc], "2026-10-28", db()))[btc]).toEqual({ snapshot: null, refreshable: false });
  });

  it("a transient error keeps the old snapshot; 'no data' stores an all-null snapshot", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    await hold(sap);
    await refreshClassifications(at("2026-10-20T10:00:00.000Z", [], recording({ "SAP.DE": SAP_FULL }).quoteSummary), db());

    const failing = recording({ "SAP.DE": new TypeError("fetch failed") });
    expect(await refreshClassifications(at("2026-10-28T10:00:00.000Z", [], failing.quoteSummary), db())).toMatchObject({ failed: 1 });
    expect(failing.calls).toHaveLength(1);
    const kept = (await listKeyFigures([sap], "2026-10-28", db()))[sap].snapshot;
    expect(kept).toMatchObject({ asOf: "2026-10-20", stale: true, figures: { trailingPE: "30.4321" } });
    expect(await refreshKeyFigures(sap, at("2026-10-28T11:00:00.000Z", [], failing.quoteSummary), db())).toEqual({ status: "failed" });

    const noData = recording({ "SAP.DE": new Error("Quote not found for symbol: SAP.DE") });
    expect(await refreshKeyFigures(sap, at("2026-10-28T12:00:00.000Z", [], noData.quoteSummary), db())).toEqual({ status: "updated" });
    const empty = (await listKeyFigures([sap], "2026-10-28", db()))[sap].snapshot;
    expect(empty).toMatchObject({ asOf: "2026-10-28", stale: false });
    expect(Object.values(empty!.figures).every((value) => value === null)).toBe(true);
    // Not retried until the next day.
    const later = recording({ "SAP.DE": SAP_FIGURES });
    await refreshClassifications(at("2026-10-28T20:00:00.000Z", [], later.quoteSummary), db());
    expect(later.calls).toEqual([]);
  });

  it("refetches on a symbol change", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    await hold(sap);
    await refreshClassifications(at("2026-10-28T10:00:00.000Z", [], recording({ "SAP.DE": SAP_FULL }).quoteSummary), db());
    await mapYahoo(sap, "SAP.F");
    // Fetched today, but for the old symbol: not fresh, so the button stays enabled.
    expect((await listKeyFigures([sap], "2026-10-28", db()))[sap].snapshot).toMatchObject({ symbol: "SAP.DE", fetchedToday: false });
    const { quoteSummary, calls } = recording({ "SAP.F": SAP_FULL });
    expect(await refreshKeyFigures(sap, at("2026-10-28T11:00:00.000Z", [], quoteSummary), db())).toEqual({ status: "updated" });
    // The Analysten-Symbol stays the resolved SAP.DE: a second request for the analyst modules.
    expect(calls).toEqual([
      { symbol: "SAP.F", modules: KEY_FIGURE_MODULES },
      { symbol: "SAP.DE", modules: ["financialData", "summaryDetail", "price", ...ANALYST_EXTRA] },
    ]);
    expect((await listKeyFigures([sap], "2026-10-28", db()))[sap].snapshot).toMatchObject({ symbol: "SAP.F", fetchedToday: true });
  });

  it("'Typ ändern' STOCK → ETF on the day of the fetch: the stock snapshot is hidden and refetched as fund figures", async () => {
    const id = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF USD (Acc)", "STOCK");
    await mapYahoo(id, "EUNL.DE");
    await hold(id);
    await refreshClassifications(at("2026-10-28T10:00:00.000Z", [], recording({ "EUNL.DE": SAP_FULL }).quoteSummary), db());
    expect((await listKeyFigures([id], "2026-10-28", db()))[id].snapshot).toMatchObject({ fetchedToday: true });
    expect((await db().securityKeyFigures.findUnique({ where: { securityId: id } }))?.kind).toBe("stock");

    await changeSecurityType(id, "ETF", db());
    expect((await listKeyFigures([id], "2026-10-28", db()))[id]).toEqual({ snapshot: null, refreshable: true });
    const { quoteSummary, calls } = recording({ "EUNL.DE": EUNL_FIGURES });
    expect(await refreshKeyFigures(id, at("2026-10-28T11:00:00.000Z", [], quoteSummary), db())).toEqual({ status: "updated" });
    expect(calls).toEqual([{ symbol: "EUNL.DE", modules: KEY_FIGURE_MODULES }]);
    expect((await listKeyFigures([id], "2026-10-28", db()))[id].snapshot).toMatchObject({
      fetchedToday: true,
      figures: { fundFamily: "iShares", trailingPE: null },
    });
  });

  it("deletes snapshots outside held ∪ watched, of a type without key figures, and with the Security", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
    const msci = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF USD (Acc)", "ETF");
    const apple = await security({ isin: "US0378331005" }, "Apple Inc.", "STOCK");
    await mapYahoo(sap, "SAP.DE");
    await mapYahoo(msci, "EUNL.DE");
    await mapYahoo(apple, "APC.DE");
    const replies = { "SAP.DE": SAP_FULL, "EUNL.DE": EUNL_FIGURES, "APC.DE": recorded("yahoo-quotesummary-keyfigures-apc-de") };
    await refreshClassifications(at("2026-10-28T10:00:00.000Z", [sap, msci, apple], recording(replies).quoteSummary), db());
    expect(await db().securityKeyFigures.count()).toBe(3);
    expect(await refreshKeyFigures(sap, at("2026-10-28T11:00:00.000Z", [msci], recording(replies).quoteSummary), db())).toEqual({
      status: "unavailable",
    });

    await changeSecurityType(apple, "CERTIFICATE", db());
    await refreshClassifications(at("2026-10-29T10:00:00.000Z", [msci, apple], recording(replies).quoteSummary), db());
    expect((await db().securityKeyFigures.findMany()).map((row) => row.securityId)).toEqual([msci]);

    // A removed Yahoo mapping forgets the snapshot of a still watched Security.
    await db().providerMapping.deleteMany({ where: { securityId: msci } });
    await refreshClassifications(at("2026-10-30T10:00:00.000Z", [msci], recording(replies).quoteSummary), db());
    expect(await db().securityKeyFigures.count()).toBe(0);
    await mapYahoo(msci, "EUNL.DE");
    await refreshClassifications(at("2026-10-30T11:00:00.000Z", [msci], recording(replies).quoteSummary), db());
    expect(await db().securityKeyFigures.count()).toBe(1);

    await db().security.delete({ where: { id: msci } });
    expect(await db().securityKeyFigures.count()).toBe(0);
  });

  it("refreshKeyFigures: not-found for an unknown id", async () => {
    expect(await refreshKeyFigures("nope", at("2026-10-28T10:00:00.000Z"), db())).toEqual({ status: "not-found" });
  });

  describe("analyst ratings (story 9.7)", () => {
    const ANALYST_MODULES = ["financialData", "summaryDetail", "price", ...ANALYST_EXTRA];
    const SAP_ANALYSTS = recorded("yahoo-quotesummary-analysts-sap-de") as Record<string, unknown>;
    const APC_FIGURES = recorded("yahoo-quotesummary-keyfigures-apc-de");
    const AAPL_ANALYSTS = recorded("yahoo-quotesummary-analysts-aapl");
    const APPLE_ISIN = "US0378331005";

    /** A fake Yahoo search recording the queries. */
    function searching(reply: unknown | Error) {
      const queries: string[] = [];
      const search: YahooSearch = async (query) => {
        queries.push(query);
        if (reply instanceof Error) throw reply;
        return reply;
      };
      return { search, queries };
    }

    async function watchedApple() {
      const apple = await security({ isin: APPLE_ISIN }, "Apple Inc.", "STOCK");
      await mapYahoo(apple, "APC.DE");
      return apple;
    }

    it("German stock: ONE request carries profile, key figures and analyst modules; the card data is stored", async () => {
      const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
      await mapYahoo(sap, "SAP.DE");
      await hold(sap);
      const { search, queries } = searching({ quotes: [{ symbol: "SAP" }, { symbol: "SAP.DE" }] });
      const { quoteSummary, calls } = recording({ "SAP.DE": { ...(SAP_PROFILE as Record<string, unknown>), ...SAP_ANALYSTS } });

      expect(await refreshClassifications(at("2026-10-28T10:00:00.000Z", [], quoteSummary, search), db())).toMatchObject({ failed: 0 });
      expect(queries).toEqual(["DE0007164600"]);
      expect(calls).toEqual([{ symbol: "SAP.DE", modules: ALL_MODULES }]);
      const snapshot = (await listKeyFigures([sap], "2026-10-28", db()))[sap].snapshot;
      expect(snapshot).toMatchObject({ symbol: "SAP.DE", analystSymbol: "SAP.DE", fetchedToday: true });
      expect(snapshot?.analysts?.trend.map((month) => month.period)).toEqual(["-3m", "-2m", "-1m", "0m"]);
      expect(snapshot?.analysts).toMatchObject({ analystCount: 51, consensusMean: "1.85", target: { mean: "270", currentPrice: "240", currency: "EUR" } });
      expect(snapshot?.analysts?.changes).toHaveLength(10);
      expect(await listAnalystSymbols(db())).toMatchObject({ [sap]: { symbol: "SAP.DE", manual: false } });
    });

    it("foreign stock on a DE listing: key figures from APC.DE, analyst data from AAPL; fresh for the rest of the day", async () => {
      const apple = await watchedApple();
      const { search, queries } = searching(recorded("yahoo-search-apple"));
      const { quoteSummary, calls } = recording({ "APC.DE": APC_FIGURES, AAPL: AAPL_ANALYSTS });

      expect(await refreshClassifications(at("2026-10-28T10:00:00.000Z", [apple], quoteSummary, search), db())).toMatchObject({ failed: 0 });
      expect(queries).toEqual([APPLE_ISIN]);
      expect(calls).toEqual([
        { symbol: "APC.DE", modules: ["assetProfile", "price", ...KEY_FIGURE_MODULES] },
        { symbol: "AAPL", modules: ANALYST_MODULES },
      ]);
      const snapshot = (await listKeyFigures([apple], "2026-10-28", db()))[apple].snapshot;
      expect(snapshot).toMatchObject({ symbol: "APC.DE", analystSymbol: "AAPL", fetchedToday: true, figures: { trailingPE: "35.12" } });
      expect(snapshot?.analysts?.target).toMatchObject({ mean: "245", currentPrice: "217.5", currency: "USD" });
      expect(await listAnalystSymbols(db())).toEqual({ [apple]: { symbol: "AAPL", manual: false } });

      const again = recording({ "APC.DE": APC_FIGURES, AAPL: AAPL_ANALYSTS });
      const againSearch = searching(recorded("yahoo-search-apple"));
      await refreshClassifications(at("2026-10-28T20:00:00.000Z", [apple], again.quoteSummary, againSearch.search), db());
      expect(await refreshKeyFigures(apple, at("2026-10-28T20:30:00.000Z", [apple], again.quoteSummary, againSearch.search), db())).toEqual({
        status: "fresh",
      });
      expect(again.calls).toEqual([]);
      expect(againSearch.queries).toEqual([]);
    });

    it("a manual symbol is never overwritten, refetches today and is cleared back to automatic; never exported", async () => {
      const apple = await watchedApple();
      const replies = { "APC.DE": APC_FIGURES, AAPL: AAPL_ANALYSTS, NVDA: AAPL_ANALYSTS };
      await refreshClassifications(at("2026-10-28T10:00:00.000Z", [apple], recording(replies).quoteSummary, searching(recorded("yahoo-search-apple")).search), db());

      expect(await setAnalystSymbol(apple, " nvda ", db())).toEqual({ ok: true });
      expect(await listAnalystSymbols(db())).toEqual({ [apple]: { symbol: "NVDA", manual: true } });
      expect((await listKeyFigures([apple], "2026-10-28", db()))[apple].snapshot).toMatchObject({ analystSymbol: "AAPL", fetchedToday: false });
      const { search, queries } = searching(recorded("yahoo-search-apple"));
      const { quoteSummary, calls } = recording(replies);
      expect(await refreshKeyFigures(apple, at("2026-10-28T11:00:00.000Z", [apple], quoteSummary, search), db())).toEqual({ status: "updated" });
      expect(calls).toEqual([
        { symbol: "APC.DE", modules: KEY_FIGURE_MODULES },
        { symbol: "NVDA", modules: ANALYST_MODULES },
      ]);
      await refreshClassifications(at("2026-10-29T10:00:00.000Z", [apple], recording(replies).quoteSummary, search), db());
      expect(queries).toEqual([]);
      expect(await listAnalystSymbols(db())).toEqual({ [apple]: { symbol: "NVDA", manual: true } });
      expect(await exportClassifications(db())).toEqual([]);
      expect(JSON.stringify(await exportClassifications(db()))).not.toMatch(/NVDA|analyst/i);

      expect(await setAnalystSymbol(apple, "", db())).toEqual({ ok: true });
      expect(await listAnalystSymbols(db())).toEqual({ [apple]: { symbol: null, manual: false } });
      await refreshClassifications(at("2026-10-29T11:00:00.000Z", [apple], recording(replies).quoteSummary, search), db());
      expect(queries).toEqual([APPLE_ISIN]);
      expect(await listAnalystSymbols(db())).toEqual({ [apple]: { symbol: "AAPL", manual: false } });
      expect((await listKeyFigures([apple], "2026-10-29", db()))[apple].snapshot).toMatchObject({ analystSymbol: "AAPL", fetchedToday: true });
    });

    it("a transient analyst error writes nothing; 'no data' stores analysts null", async () => {
      const apple = await watchedApple();
      const search = searching(recorded("yahoo-search-apple")).search;
      const failing = recording({ "APC.DE": APC_FIGURES, AAPL: new TypeError("fetch failed") });
      expect(await refreshClassifications(at("2026-10-28T10:00:00.000Z", [apple], failing.quoteSummary, search), db())).toMatchObject({ failed: 1 });
      expect(await db().securityKeyFigures.count()).toBe(0);
      expect(await refreshKeyFigures(apple, at("2026-10-28T11:00:00.000Z", [apple], failing.quoteSummary, search), db())).toEqual({ status: "failed" });
      expect(await db().securityKeyFigures.count()).toBe(0);

      const noData = recording({ "APC.DE": APC_FIGURES });
      expect(await refreshKeyFigures(apple, at("2026-10-28T12:00:00.000Z", [apple], noData.quoteSummary, search), db())).toEqual({ status: "updated" });
      expect((await listKeyFigures([apple], "2026-10-28", db()))[apple].snapshot).toMatchObject({
        analystSymbol: "AAPL",
        analysts: null,
        figures: { trailingPE: "35.12" },
      });
    });

    it("a search error still stores the key figures (without analyst data), counts as failed and retries next run", async () => {
      const apple = await watchedApple();
      const replies = { "APC.DE": APC_FIGURES, AAPL: AAPL_ANALYSTS };
      const failing = searching(new TypeError("fetch failed"));
      const first = recording(replies);
      expect(await refreshClassifications(at("2026-10-28T10:00:00.000Z", [apple], first.quoteSummary, failing.search), db())).toMatchObject({
        failed: 1,
      });
      expect(first.calls).toEqual([{ symbol: "APC.DE", modules: ["assetProfile", "price", ...KEY_FIGURE_MODULES] }]);
      expect((await listKeyFigures([apple], "2026-10-28", db()))[apple].snapshot).toMatchObject({ analystSymbol: null, analysts: null, fetchedToday: true });
      expect(await listAnalystSymbols(db())).toEqual({ [apple]: { symbol: null, manual: false } });

      const working = searching(recorded("yahoo-search-apple"));
      const second = recording(replies);
      expect(await refreshClassifications(at("2026-10-28T11:00:00.000Z", [apple], second.quoteSummary, working.search), db())).toMatchObject({
        failed: 0,
      });
      expect(working.queries).toEqual([APPLE_ISIN]);
      expect(second.calls).toEqual([
        { symbol: "APC.DE", modules: KEY_FIGURE_MODULES },
        { symbol: "AAPL", modules: ANALYST_MODULES },
      ]);
      expect((await listKeyFigures([apple], "2026-10-28", db()))[apple].snapshot?.analysts?.target.currency).toBe("USD");
    });

    it("never searches or asks analyst modules for ETFs or untracked stocks; an ETF snapshot has no analyst data", async () => {
      const msci = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF USD (Acc)", "ETF");
      const apple = await watchedApple();
      await mapYahoo(msci, "EUNL.DE");
      const { search, queries } = searching(recorded("yahoo-search-apple"));
      const { quoteSummary, calls } = recording({ "EUNL.DE": EUNL_FIGURES, "APC.DE": APC_FIGURES });
      await refreshClassifications(at("2026-10-28T10:00:00.000Z", [msci], quoteSummary, search), db());
      expect(queries).toEqual([]);
      expect(calls).toEqual(
        expect.arrayContaining([
          { symbol: "EUNL.DE", modules: KEY_FIGURE_MODULES },
          { symbol: "APC.DE", modules: ["assetProfile", "price"] },
        ]),
      );
      expect(calls).toHaveLength(2);
      expect((await listKeyFigures([msci], "2026-10-28", db()))[msci].snapshot).toMatchObject({ analystSymbol: null, analysts: null });
      expect((await listAnalystSymbols(db()))[apple]).toEqual({ symbol: null, manual: false });
    });

    it("a manual symbol saved while the search runs is kept (the resolution writes only an unresolved automatic symbol)", async () => {
      const apple = await watchedApple();
      const racing: YahooSearch = async () => {
        expect(await setAnalystSymbol(apple, "NVDA", db())).toEqual({ ok: true });
        return recorded("yahoo-search-apple");
      };
      const { quoteSummary, calls } = recording({ "APC.DE": APC_FIGURES, NVDA: AAPL_ANALYSTS });
      await refreshClassifications(at("2026-10-28T10:00:00.000Z", [apple], quoteSummary, racing), db());
      expect(await listAnalystSymbols(db())).toEqual({ [apple]: { symbol: "NVDA", manual: true } });
      expect(calls.map((call) => call.symbol)).toEqual(["APC.DE", "NVDA"]);
    });

    it("a lowercase mapping symbol equal to the analyst symbol shares one request", async () => {
      const sap = await security({ isin: "DE0007164600" }, "SAP SE", "STOCK");
      await mapYahoo(sap, "sap.de");
      await hold(sap);
      const { quoteSummary, calls } = recording({ "sap.de": SAP_ANALYSTS });
      await refreshClassifications(at("2026-10-28T10:00:00.000Z", [], quoteSummary, searching({ quotes: [{ symbol: "SAP.DE" }] }).search), db());
      expect(calls).toEqual([{ symbol: "sap.de", modules: ALL_MODULES }]);
      expect((await listKeyFigures([sap], "2026-10-28", db()))[sap].snapshot?.analysts?.analystCount).toBe(51);
    });

    it("refreshKeyFigures with a failing search: key figures stored without analyst data, no analyst request", async () => {
      const apple = await watchedApple();
      const { quoteSummary, calls } = recording({ "APC.DE": APC_FIGURES, AAPL: AAPL_ANALYSTS });
      const failing = searching(new TypeError("fetch failed"));
      expect(await refreshKeyFigures(apple, at("2026-10-28T10:00:00.000Z", [apple], quoteSummary, failing.search), db())).toEqual({
        status: "updated",
      });
      expect(failing.queries).toEqual([APPLE_ISIN]);
      expect(calls).toEqual([{ symbol: "APC.DE", modules: KEY_FIGURE_MODULES }]);
      expect((await listKeyFigures([apple], "2026-10-28", db()))[apple].snapshot).toMatchObject({
        analystSymbol: null,
        analysts: null,
        figures: { trailingPE: "35.12" },
      });
    });

    it("an ETF's stored snapshot never exposes analyst data", async () => {
      const msci = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF USD (Acc)", "ETF");
      await mapYahoo(msci, "EUNL.DE");
      await db().securityKeyFigures.create({
        data: {
          securityId: msci,
          symbol: "EUNL.DE",
          kind: "fund",
          figures: "{}",
          analystSymbol: "EUNL.DE",
          analysts: JSON.stringify({ trend: [{ period: "0m", strongBuy: 1, buy: 2, hold: 0, sell: 0, strongSell: 0 }], consensusMean: "1.5" }),
          fetchedAt: "2026-10-28T10:00:00.000Z",
        },
      });
      expect((await listKeyFigures([msci], "2026-10-28", db()))[msci].snapshot).toMatchObject({ analystSymbol: null, analysts: null });
    });

    it("setAnalystSymbol validates before writing", async () => {
      const apple = await watchedApple();
      const msci = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World UCITS ETF USD (Acc)", "ETF");
      expect(await setAnalystSymbol("missing", "AAPL", db())).toEqual({ ok: false, reason: "not-found" });
      expect(await setAnalystSymbol(msci, "EUNL.DE", db())).toEqual({ ok: false, reason: "not-a-stock" });
      expect(await setAnalystSymbol(apple, "bad symbol", db())).toEqual({ ok: false, reason: "symbol-invalid" });
      expect(await setAnalystSymbol(apple, "X".repeat(41), db())).toEqual({ ok: false, reason: "symbol-invalid" });
      expect(await setAnalystSymbol(apple, 42, db())).toEqual({ ok: false, reason: "symbol-invalid" });
      expect(await db().securityClassification.count()).toBe(0);
    });

    it("reads a stored analyst JSON defensively", async () => {
      const apple = await watchedApple();
      await db().securityKeyFigures.create({
        data: {
          securityId: apple,
          symbol: "APC.DE",
          kind: "stock",
          figures: "{}",
          analystSymbol: "AAPL",
          analysts: JSON.stringify({ trend: [{ period: "0m", strongBuy: 1, buy: "2" }, { period: "-1m", strongBuy: 1, buy: 2, hold: 0, sell: 0, strongSell: 0 }], target: { mean: 270 } }),
          fetchedAt: "2026-10-28T10:00:00.000Z",
        },
      });
      // The current month is unreadable and the mean is not a string: nothing worth showing.
      expect((await listKeyFigures([apple], "2026-10-28", db()))[apple].snapshot?.analysts).toBeNull();
      await db().securityKeyFigures.update({ where: { securityId: apple }, data: { analysts: "not json" } });
      expect((await listKeyFigures([apple], "2026-10-28", db()))[apple].snapshot?.analysts).toBeNull();
    });
  });
});
