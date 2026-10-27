import { describe, expect, it } from "vitest";
import {
  type AutomaticLayer,
  baseName,
  companySizeOf,
  DIMENSIONS,
  effective,
  emptyLayer,
  emptyManual,
  findUnderlying,
  fundRules,
  mergeAutomatic,
  providerValues,
  ruleValues,
  sameLayer,
} from "./classification";

/** Values of a layer, dimensions without a value left out. */
function values(layer: AutomaticLayer): Record<string, string> {
  return Object.fromEntries(DIMENSIONS.filter((d) => layer[d].value !== null).map((d) => [d, layer[d].value as string]));
}

function sources(layer: AutomaticLayer): Record<string, string> {
  return Object.fromEntries(DIMENSIONS.filter((d) => layer[d].value !== null).map((d) => [d, layer[d].source as string]));
}

const SAP_PROFILE = {
  sector: "Technology",
  industry: "Software—Application",
  country: "Germany",
  marketCap: "200000000000",
  currency: "EUR",
};

describe("providerValues / companySizeOf", () => {
  it("maps a Yahoo stock profile to German labels with region and company size", () => {
    const layer = providerValues(SAP_PROFILE);
    expect(values(layer)).toEqual({
      sector: "Technologie",
      industry: "Software—Application",
      region: "Europa",
      country: "Deutschland",
      companySize: "Large Cap",
      currency: "EUR",
    });
    expect(new Set(Object.values(sources(layer)))).toEqual(new Set(["PROVIDER"]));
    expect(layer.assetClass).toEqual({ value: null, source: null });
  });

  it("keeps unmapped sectors and countries verbatim (region null) and drops invalid currencies", () => {
    const layer = providerValues({ sector: "Space Mining", industry: " ", country: "Atlantis", marketCap: null, currency: "eur1" });
    expect(values(layer)).toEqual({ sector: "Space Mining", country: "Atlantis" });
  });

  it("maps US to USA and Canada to Nordamerika", () => {
    expect(values(providerValues({ ...SAP_PROFILE, country: "United States" }))).toMatchObject({ country: "USA", region: "USA" });
    expect(values(providerValues({ ...SAP_PROFILE, country: "Canada" }))).toMatchObject({ country: "Kanada", region: "Nordamerika" });
  });

  it.each([
    ["10000000000", "Large Cap"],
    ["9999999999.99", "Mid Cap"],
    ["2000000000", "Mid Cap"],
    ["1999999999", "Small Cap"],
    ["1e+21", "Large Cap"],
    ["0", null],
    ["-5", null],
    ["abc", null],
    [null, null],
  ])("company size of %s is %s", (cap, size) => {
    expect(companySizeOf(cap)).toBe(size);
  });
});

describe("fundRules", () => {
  it.each([
    ["iShares Core MSCI World UCITS ETF USD (Acc)", { assetClass: "Aktien", region: "Welt", country: null, currency: "USD" }],
    ["Xtrackers MSCI Emerging Markets", { assetClass: "Aktien", region: "Schwellenländer", country: null, currency: null }],
    ["Vanguard S&P 500", { assetClass: "Aktien", region: "USA", country: "USA", currency: null }],
    ["iShares STOXX Europe 600", { assetClass: "Aktien", region: "Europa", country: null, currency: null }],
    ["iShares Core DAX UCITS ETF (DE)", { assetClass: "Aktien", region: "Europa", country: "Deutschland", currency: null }],
    ["Vanguard FTSE All-World", { assetClass: "Aktien", region: "Welt", country: null, currency: null }],
    ["DWS Vermögensbildungsfonds I", { assetClass: null, region: null, country: null, currency: null }],
    ["iShares Core MSCI Pacific ex Japan", { assetClass: "Aktien", region: "Asien-Pazifik", country: null, currency: null }],
    ["Xtrackers MSCI World ex USA", { assetClass: "Aktien", region: "Welt", country: null, currency: null }],
    ["iShares MSCI Asia ex-Japan", { assetClass: "Aktien", region: "Asien-Pazifik", country: null, currency: null }],
    ["iShares MSCI Japan Euro Hedged", { assetClass: "Aktien", region: "Asien-Pazifik", country: "Japan", currency: null }],
  ])("%s", (name, expected) => {
    expect(fundRules(name)).toEqual(expected);
  });

  it.each([
    ["iShares Euro Gov Bond", "Anleihen"],
    ["Xetra-Gold ETC", "Rohstoffe"],
    ["iShares Developed Markets Property Yield", "Immobilien"],
    ["Xtrackers II EUR Overnight Rate Swap", "Geldmarkt"],
    ["Vanguard LifeStrategy 80% Equity", "Gemischt"],
    ["Goldman Sachs Fund", null],
  ])("asset class of %s is %s", (name, assetClass) => {
    expect(fundRules(name).assetClass).toBe(assetClass);
  });
});

describe("findUnderlying / baseName", () => {
  const known = [
    { id: "sap", name: "SAP SE" },
    { id: "deutsche", name: "Deutsche Bank AG" },
    { id: "deutsche-post", name: "Deutsche Post AG" },
    { id: "alphabet", name: "Alphabet Inc. Class A" },
    { id: "bp", name: "BP plc" },
  ];

  it.each([
    ["SAP SE", "SAP"],
    ["Alphabet Inc. Class A", "Alphabet"],
    ["Volkswagen AG Vz.", "Volkswagen"],
    ["Mercedes-Benz Group AG", "Mercedes-Benz"],
    ["SE", "SE"],
  ])("base name of %s is %s", (name, base) => {
    expect(baseName(name)).toBe(base);
  });

  it("finds the underlying by whole-word base name; the longest wins", () => {
    expect(findUnderlying("Turbo Long auf SAP SE", known)).toBe("sap");
    expect(findUnderlying("Mini Future Short Deutsche Post", known)).toBe("deutsche-post");
    expect(findUnderlying("Optionsschein Call Alphabet", known)).toBe("alphabet");
  });

  it("ignores partial words and base names shorter than 3 characters", () => {
    expect(findUnderlying("Turbo Long SAPPHIRE", known)).toBeNull();
    expect(findUnderlying("Turbo Long BP", known)).toBeNull();
    expect(findUnderlying("Mini Future Long DAX", known)).toBeNull();
  });
});

describe("ruleValues", () => {
  it("classifies a stock as Aktien only (the provider fills the rest)", () => {
    expect(values(ruleValues({ name: "SAP SE", assetType: "STOCK" }))).toEqual({ assetClass: "Aktien" });
  });

  it("classifies an ETF as a whole with company size –", () => {
    const layer = ruleValues({ name: "iShares Core MSCI World UCITS ETF USD (Acc)", assetType: "ETF" });
    expect(values(layer)).toEqual({ assetClass: "Aktien", region: "Welt", companySize: "–", currency: "USD" });
    expect(new Set(Object.values(sources(layer)))).toEqual(new Set(["RULE"]));
  });

  it("leaves an unmatched fund unknown", () => {
    expect(values(ruleValues({ name: "DWS Vermögensbildungsfonds I", assetType: "FUND" }))).toEqual({ companySize: "–" });
  });

  it("classifies crypto as Krypto", () => {
    expect(values(ruleValues({ name: "Bitcoin", assetType: "CRYPTO" }))).toEqual({ assetClass: "Krypto", companySize: "–" });
  });

  it("gives a certificate its underlying's effective values as rule values", () => {
    const underlying = effective(
      { automatic: mergeAutomatic(null, ruleValues({ name: "SAP SE", assetType: "STOCK" }), providerValues(SAP_PROFILE), "STOCK"), manual: { ...emptyManual(), sector: "Halbleiter" } },
      "STOCK",
    );
    const layer = ruleValues({ name: "Turbo Long auf SAP SE", assetType: "CERTIFICATE" }, underlying);
    expect(values(layer)).toEqual({
      assetClass: "Aktien",
      sector: "Halbleiter",
      industry: "Software—Application",
      region: "Europa",
      country: "Deutschland",
      companySize: "Large Cap",
      currency: "EUR",
    });
    expect(new Set(Object.values(sources(layer)))).toEqual(new Set(["RULE"]));
  });

  it("falls back to Derivate / Rohstoffe when the matched underlying has no asset class", () => {
    const unknown = effective(null, "UNCLASSIFIED");
    expect(values(ruleValues({ name: "Turbo Long auf Unbekannt AG", assetType: "CERTIFICATE" }, unknown))).toEqual({
      assetClass: "Derivate",
      companySize: "–",
    });
    expect(ruleValues({ name: "Turbo Long Gold auf Unbekannt AG", assetType: "CERTIFICATE" }, unknown).assetClass.value).toBe("Rohstoffe");
  });

  it("classifies a certificate without underlying as Derivate, commodity keywords as Rohstoffe", () => {
    expect(values(ruleValues({ name: "Mini Future Long DAX", assetType: "CERTIFICATE" }))).toEqual({ assetClass: "Derivate", companySize: "–" });
    expect(ruleValues({ name: "Xetra-Gold ETC", assetType: "CERTIFICATE" }).assetClass.value).toBe("Rohstoffe");
    expect(ruleValues({ name: "Turbo Long Silber", assetType: "CERTIFICATE" }).assetClass.value).toBe("Rohstoffe");
  });

  it("leaves an unclassified Security unknown", () => {
    expect(values(ruleValues({ name: "Unbekannt AG", assetType: "UNCLASSIFIED" }))).toEqual({});
  });
});

describe("mergeAutomatic", () => {
  const rules = ruleValues({ name: "SAP SE", assetType: "STOCK" });
  const provider = providerValues(SAP_PROFILE);

  it("combines rule asset class with fresh provider values for a stock", () => {
    const merged = mergeAutomatic(null, rules, provider, "STOCK");
    expect(values(merged)).toEqual({
      assetClass: "Aktien",
      sector: "Technologie",
      industry: "Software—Application",
      region: "Europa",
      country: "Deutschland",
      companySize: "Large Cap",
      currency: "EUR",
    });
    expect(merged.assetClass.source).toBe("RULE");
    expect(merged.sector.source).toBe("PROVIDER");
  });

  it("keeps stored provider values when nothing new was fetched", () => {
    const stored = mergeAutomatic(null, rules, provider, "STOCK");
    expect(sameLayer(mergeAutomatic(stored, rules, null, "STOCK"), stored)).toBe(true);
  });

  it("lets a fresh provider result replace stored provider values (missing ones fall back to rules)", () => {
    const stored = mergeAutomatic(null, rules, provider, "STOCK");
    const fresh = providerValues({ ...SAP_PROFILE, sector: "Industrials", currency: null });
    const merged = mergeAutomatic(stored, rules, fresh, "STOCK");
    expect(merged.sector.value).toBe("Industrie");
    expect(merged.currency).toEqual({ value: null, source: null });
  });

  it("uses only the rules for non-stocks (stored provider values are dropped)", () => {
    const stored = mergeAutomatic(null, rules, provider, "STOCK");
    const etfRules = ruleValues({ name: "Vanguard S&P 500", assetType: "ETF" });
    expect(mergeAutomatic(stored, etfRules, provider, "ETF")).toEqual(etfRules);
  });
});

describe("effective", () => {
  it("lets a manual value win and keeps the automatic value underneath", () => {
    const automatic = mergeAutomatic(null, ruleValues({ name: "SAP SE", assetType: "STOCK" }), providerValues(SAP_PROFILE), "STOCK");
    const result = effective({ automatic, manual: { ...emptyManual(), sector: "Halbleiter" } }, "STOCK");
    expect(result.type).toBe("STOCK");
    expect(result.sector).toEqual({
      value: "Halbleiter",
      source: "manual",
      manual: "Halbleiter",
      automatic: { value: "Technologie", source: "provider" },
    });
    expect(result.assetClass).toMatchObject({ value: "Aktien", source: "rule", manual: null });
  });

  it("reports unknown values for a missing row", () => {
    const result = effective(null, "CRYPTO");
    expect(result.type).toBe("CRYPTO");
    for (const dimension of DIMENSIONS) {
      expect(result[dimension]).toEqual({ value: null, source: null, manual: null, automatic: { value: null, source: null } });
    }
  });

  it("treats an empty layer like a missing row", () => {
    expect(effective({ automatic: emptyLayer(), manual: emptyManual() }, "ETF")).toEqual(effective(null, "ETF"));
  });
});
