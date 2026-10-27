import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorded } from "../../../test/helpers/providers";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { changeSecurityType, ensureSecurity } from "@/modules/ledger";
import { setMapping } from "@/modules/prices";
import {
  type ClassificationDeps,
  exportClassifications,
  listClassifications,
  refreshClassifications,
  replaceAllClassifications,
  setManualClassification,
} from "./index";
import type { YahooQuoteSummary } from "./providers/yahoo";

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
