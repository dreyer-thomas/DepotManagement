/**
 * Security classification decisions (AD-20, story 7.1). Pure: no lookups, no clock. The shell
 * (`modules/classification`) loads Securities, provider profiles and stored rows and persists what these
 * functions decide.
 *
 * Two layers per dimension: an automatic value with its source (`PROVIDER` = Yahoo profile of a stock,
 * `RULE` = the name/type rules below) and an optional manual value, which always wins. Stored values are
 * German labels; `null` is shown as "Unbekannt". The type dimension is the ledger's `assetType`.
 */
import Decimal from "decimal.js";
import { termPattern } from "./asset-type";

export const ASSET_CLASSES = ["Aktien", "Anleihen", "Rohstoffe", "Immobilien", "Geldmarkt", "Krypto", "Derivate", "Gemischt"] as const;
export const REGIONS = ["Welt", "Europa", "USA", "Nordamerika", "Asien-Pazifik", "Schwellenländer"] as const;
export const COMPANY_SIZES = ["Large Cap", "Mid Cap", "Small Cap", "–"] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];
export type Region = (typeof REGIONS)[number];
export type CompanySize = (typeof COMPANY_SIZES)[number];

/** The stored dimensions (type is not stored: it is the ledger's `assetType`). */
export const DIMENSIONS = ["assetClass", "sector", "industry", "region", "country", "companySize", "currency"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** ISO 4217-shaped currency code. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Ledger asset types as plain strings (core does not import Prisma types). */
export type ClassifiedAssetType = "STOCK" | "ETF" | "FUND" | "CERTIFICATE" | "CRYPTO" | "UNCLASSIFIED";

export type AutomaticSource = "PROVIDER" | "RULE";

/** One automatic value; `value: null` always has `source: null`. */
export type AutomaticValue = { value: string | null; source: AutomaticSource | null };

/** The automatic layer of one Security, every dimension present. */
export type AutomaticLayer = Record<Dimension, AutomaticValue>;

/** Manual overrides per dimension (`null` = automatic). */
export type ManualLayer = Record<Dimension, string | null>;

export type EffectiveSource = "manual" | "provider" | "rule";

/** Effective value of a dimension: manual ?? automatic, with both layers for editing. */
export type DimensionValue = {
  value: string | null;
  source: EffectiveSource | null;
  manual: string | null;
  automatic: { value: string | null; source: Exclude<EffectiveSource, "manual"> | null };
};

/** The effective classification of a Security. `type` is the ledger's `assetType` (source: ledger). */
export type Classification = Record<Dimension, DimensionValue> & { type: ClassifiedAssetType };

/** Yahoo `assetProfile.sector` → German label. Unmapped sectors are kept verbatim. */
export const SECTOR_LABELS: Readonly<Record<string, string>> = {
  Technology: "Technologie",
  Healthcare: "Gesundheit",
  "Financial Services": "Finanzen",
  "Consumer Cyclical": "Zyklische Konsumgüter",
  "Consumer Defensive": "Basiskonsumgüter",
  Industrials: "Industrie",
  Energy: "Energie",
  "Basic Materials": "Grundstoffe",
  "Communication Services": "Kommunikation",
  Utilities: "Versorger",
  "Real Estate": "Immobilien",
};

/** Yahoo `assetProfile.country` (English) → German label and region. Unmapped: verbatim, region null. */
export const COUNTRIES: Readonly<Record<string, { label: string; region: Region }>> = {
  Germany: { label: "Deutschland", region: "Europa" },
  Austria: { label: "Österreich", region: "Europa" },
  Switzerland: { label: "Schweiz", region: "Europa" },
  France: { label: "Frankreich", region: "Europa" },
  Netherlands: { label: "Niederlande", region: "Europa" },
  Belgium: { label: "Belgien", region: "Europa" },
  Luxembourg: { label: "Luxemburg", region: "Europa" },
  Ireland: { label: "Irland", region: "Europa" },
  "United Kingdom": { label: "Vereinigtes Königreich", region: "Europa" },
  Jersey: { label: "Jersey", region: "Europa" },
  Italy: { label: "Italien", region: "Europa" },
  Spain: { label: "Spanien", region: "Europa" },
  Portugal: { label: "Portugal", region: "Europa" },
  Sweden: { label: "Schweden", region: "Europa" },
  Denmark: { label: "Dänemark", region: "Europa" },
  Norway: { label: "Norwegen", region: "Europa" },
  Finland: { label: "Finnland", region: "Europa" },
  Poland: { label: "Polen", region: "Europa" },
  Greece: { label: "Griechenland", region: "Europa" },
  "United States": { label: "USA", region: "USA" },
  Canada: { label: "Kanada", region: "Nordamerika" },
  Japan: { label: "Japan", region: "Asien-Pazifik" },
  Australia: { label: "Australien", region: "Asien-Pazifik" },
  "New Zealand": { label: "Neuseeland", region: "Asien-Pazifik" },
  "Hong Kong": { label: "Hongkong", region: "Asien-Pazifik" },
  Singapore: { label: "Singapur", region: "Asien-Pazifik" },
  China: { label: "China", region: "Schwellenländer" },
  Taiwan: { label: "Taiwan", region: "Schwellenländer" },
  "South Korea": { label: "Südkorea", region: "Schwellenländer" },
  India: { label: "Indien", region: "Schwellenländer" },
  Brazil: { label: "Brasilien", region: "Schwellenländer" },
  Mexico: { label: "Mexiko", region: "Schwellenländer" },
  "South Africa": { label: "Südafrika", region: "Schwellenländer" },
};

const EMPTY: AutomaticValue = { value: null, source: null };

/** An automatic layer with every dimension unknown. */
export function emptyLayer(): AutomaticLayer {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, EMPTY])) as AutomaticLayer;
}

/** A manual layer without overrides. */
export function emptyManual(): ManualLayer {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, null])) as ManualLayer;
}

function layer(source: AutomaticSource, values: Partial<Record<Dimension, string | null>>): AutomaticLayer {
  const result = emptyLayer();
  for (const dimension of DIMENSIONS) {
    const value = values[dimension];
    if (value !== undefined && value !== null && value !== "") result[dimension] = { value, source };
  }
  return result;
}

// ---- Rules for ETFs and funds (classified as a whole, no look-through) ----

/** First matching rule wins. */
const ASSET_CLASS_RULES: readonly [RegExp, AssetClass][] = [
  [termPattern(["Money Market", "Geldmarkt", "Overnight", "ESTR", "€STR", "Ultrashort"]), "Geldmarkt"],
  [termPattern(["Bond", "Bonds", "Anleihe", "Anleihen", "Renten", "Rentenfonds", "Gov", "Government", "Treasury", "Treasuries", "Aggregate"]), "Anleihen"],
  [termPattern(["Gold", "Silber", "Silver", "Platin", "Platinum", "ETC", "Commodity", "Commodities", "Rohstoff", "Rohstoffe"]), "Rohstoffe"],
  [termPattern(["REIT", "REITs", "Property", "Real Estate", "Immobilien", "EPRA", "Nareit"]), "Immobilien"],
  [termPattern(["Multi Asset", "Mischfonds", "Balanced", "LifeStrategy"]), "Gemischt"],
  [
    termPattern([
      "MSCI",
      "S&P 500",
      "S&P500",
      "STOXX",
      "DAX",
      "MDAX",
      "SDAX",
      "TecDAX",
      "Nasdaq",
      "Nasdaq-100",
      "Dow Jones",
      "FTSE",
      "Nikkei",
      "TOPIX",
      "Russell",
      "Equity",
      "Aktien",
      "Dividend",
      "All-World",
    ]),
    "Aktien",
  ],
];

/** First matching rule wins; `country` is set only where the index names one country. */
const REGION_RULES: readonly [RegExp, Region, string | null][] = [
  [termPattern(["Emerging Markets", "Emerging", "EM", "Schwellenländer", "BRIC"]), "Schwellenländer", null],
  [termPattern(["World", "Welt", "ACWI", "All-World", "All World", "Global", "Developed Markets", "Developed World"]), "Welt", null],
  [termPattern(["North America", "Nordamerika"]), "Nordamerika", null],
  [termPattern(["S&P 500", "S&P500", "USA", "US", "Nasdaq", "Nasdaq-100", "Dow Jones", "Russell"]), "USA", "USA"],
  [termPattern(["DAX", "MDAX", "SDAX", "TecDAX"]), "Europa", "Deutschland"],
  [termPattern(["Japan", "Nikkei", "TOPIX"]), "Asien-Pazifik", "Japan"],
  [termPattern(["Pacific", "Asia", "Asien", "Australia"]), "Asien-Pazifik", null],
  [termPattern(["Europe", "Europa", "STOXX", "Euro", "Eurozone", "EMU"]), "Europa", null],
];

/** Exclusion phrases such as "ex Japan" / "ex USA" name what an index leaves out; dropped before region matching. */
const EXCLUSION = /(?<![\p{L}\p{N}])ex[\s-]+[\p{L}\p{N}]+/giu;

const CURRENCY_TOKEN = /(?<![\p{L}\p{N}])(USD|EUR|GBP|CHF|JPY)(?![\p{L}\p{N}])/u;

/** Asset class, region, country and currency of an ETF or fund from its name; unmatched → null. */
export function fundRules(name: string): Pick<Record<Dimension, string | null>, "assetClass" | "region" | "country" | "currency"> {
  const assetClass = ASSET_CLASS_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? null;
  const regionName = name.replace(EXCLUSION, " ");
  const region = REGION_RULES.find(([pattern]) => pattern.test(regionName));
  return {
    assetClass,
    region: region?.[1] ?? null,
    country: region?.[2] ?? null,
    currency: CURRENCY_TOKEN.exec(name)?.[1] ?? null,
  };
}

const COMMODITY = termPattern(["Gold", "Silber", "Silver", "ETC", "Platin", "Platinum"]);

// ---- Provider (Yahoo quoteSummary) values of a stock ----

/** A stock profile as read from the provider; `marketCap` is a decimal string. */
export type ProviderProfile = {
  sector: string | null;
  industry: string | null;
  country: string | null;
  marketCap: string | null;
  currency: string | null;
};

const LARGE_CAP = new Decimal("1e10");
const MID_CAP = new Decimal("2e9");

/** Company size by market capitalisation: ≥ 10 bn Large, ≥ 2 bn Mid, else Small; none / ≤ 0 → null. */
export function companySizeOf(marketCap: string | null): CompanySize | null {
  if (marketCap === null) return null;
  let cap: Decimal;
  try {
    cap = new Decimal(marketCap);
  } catch {
    return null;
  }
  if (!cap.isFinite() || cap.lte(0)) return null;
  if (cap.gte(LARGE_CAP)) return "Large Cap";
  if (cap.gte(MID_CAP)) return "Mid Cap";
  return "Small Cap";
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The provider layer of a stock profile (asset class stays a rule). */
export function providerValues(profile: ProviderProfile): AutomaticLayer {
  const sector = clean(profile.sector);
  const country = clean(profile.country);
  const known = country !== null ? COUNTRIES[country] : undefined;
  const currency = clean(profile.currency)?.toUpperCase() ?? null;
  return layer("PROVIDER", {
    sector: sector !== null ? (SECTOR_LABELS[sector] ?? sector) : null,
    industry: clean(profile.industry),
    country: known?.label ?? country,
    region: known?.region ?? null,
    companySize: companySizeOf(profile.marketCap),
    currency: currency !== null && CURRENCY_PATTERN.test(currency) ? currency : null,
  });
}

// ---- Certificates: underlying by name ----

const LEGAL_SUFFIXES = new Set([
  "se",
  "ag",
  "kgaa",
  "&",
  "co",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "plc",
  "nv",
  "n.v",
  "sa",
  "s.a",
  "ltd",
  "limited",
  "llc",
  "o.n",
  "on",
  "vz",
  "vzo",
  "na",
  "inh",
  "reg",
  "registered",
  "shares",
  "namens-aktien",
  "inhaber-aktien",
  "group",
  "holding",
  "holdings",
]);

/** A Security name without legal-form suffixes ("SAP SE" → "SAP", "Alphabet Inc. Class A" → "Alphabet"). */
export function baseName(name: string): string {
  const tokens = name
    .normalize("NFC")
    .replace(/\s+(?:class|cl\.)\s+[a-z]\b.*$/i, "")
    .trim()
    .split(/\s+/);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase().replace(/[.,]+$/, ""))) tokens.pop();
  return tokens.join(" ").replace(/[.,]+$/, "");
}

/**
 * The known Security a certificate is written on: the one whose base name (≥ 3 characters) occurs as a
 * whole word/phrase in the certificate name; the longest base name wins, ties go to the first given.
 */
export function findUnderlying(name: string, known: readonly { id: string; name: string }[]): string | null {
  let best: { id: string; length: number } | null = null;
  for (const candidate of known) {
    const base = baseName(candidate.name);
    if (base.length < 3) continue;
    if (!termPattern([base]).test(name)) continue;
    if (!best || base.length > best.length) best = { id: candidate.id, length: base.length };
  }
  return best?.id ?? null;
}

// ---- Rule layer and merge ----

/**
 * Rule values of a Security; a certificate with a known underlying that has an asset class takes the
 * underlying's effective values, otherwise the Derivate / Rohstoffe fallback.
 */
export function ruleValues(
  security: { name: string; assetType: ClassifiedAssetType },
  underlying?: Record<Dimension, { value: string | null }> | null,
): AutomaticLayer {
  switch (security.assetType) {
    case "STOCK":
      return layer("RULE", { assetClass: "Aktien" });
    case "ETF":
    case "FUND":
      return layer("RULE", { ...fundRules(security.name), companySize: "–" });
    case "CRYPTO":
      return layer("RULE", { assetClass: "Krypto", companySize: "–" });
    case "CERTIFICATE":
      if (underlying?.assetClass.value) {
        return layer("RULE", Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, underlying[dimension].value])));
      }
      return layer("RULE", { assetClass: COMMODITY.test(security.name) ? "Rohstoffe" : "Derivate", companySize: "–" });
    default:
      return emptyLayer();
  }
}

/**
 * The new automatic layer. Non-stocks: the rules alone. Stocks: a fresh provider result (`provider`,
 * null when none was fetched or the provider had no data) replaces the stored provider values;
 * otherwise stored PROVIDER values are kept; every remaining dimension takes the rule value.
 */
export function mergeAutomatic(
  stored: AutomaticLayer | null,
  rules: AutomaticLayer,
  provider: AutomaticLayer | null,
  assetType: ClassifiedAssetType,
): AutomaticLayer {
  if (assetType !== "STOCK") return { ...rules };
  const result = emptyLayer();
  for (const dimension of DIMENSIONS) {
    const fresh = provider?.[dimension];
    const kept = stored?.[dimension];
    if (provider) result[dimension] = fresh?.value ? fresh : rules[dimension];
    else if (kept?.source === "PROVIDER" && kept.value) result[dimension] = kept;
    else result[dimension] = rules[dimension];
  }
  return result;
}

/** Whether two automatic layers hold the same values and sources. */
export function sameLayer(a: AutomaticLayer, b: AutomaticLayer): boolean {
  return DIMENSIONS.every((dimension) => a[dimension].value === b[dimension].value && a[dimension].source === b[dimension].source);
}

const SOURCE: Record<AutomaticSource, Exclude<EffectiveSource, "manual">> = { PROVIDER: "provider", RULE: "rule" };

/** The effective classification: per dimension manual ?? automatic; type from the ledger. */
export function effective(
  row: { automatic: AutomaticLayer; manual: ManualLayer } | null,
  assetType: ClassifiedAssetType,
): Classification {
  const automatic = row?.automatic ?? emptyLayer();
  const manual = row?.manual ?? emptyManual();
  const result = { type: assetType } as Classification;
  for (const dimension of DIMENSIONS) {
    const auto = automatic[dimension];
    const autoValue = {
      value: auto.value,
      source: auto.value !== null && auto.source !== null ? SOURCE[auto.source] : null,
    };
    const own = manual[dimension];
    result[dimension] =
      own !== null
        ? { value: own, source: "manual", manual: own, automatic: autoValue }
        : { value: autoValue.value, source: autoValue.source, manual: null, automatic: autoValue };
  }
  return result;
}
