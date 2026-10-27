/**
 * Asset-type estimate of a Security from its name alone (AD-16, story 2-5). Pure: no lookups. Used by
 * the Parqet migration, whose export does not distinguish stock, ETF, fund or certificate; the user can
 * override the estimate.
 *
 * Case-insensitive whole-word/phrase matching (so "Fletcher" is not an ETC); first rule wins:
 * 1. ETF, ETC, ETN, "UCITS ETF" or an ETF issuer → ETF
 * 2. Turbo, Knock-Out, Mini Future, Optionsschein, Open End → CERTIFICATE
 * 3. SICAV, Fund, Funds, Fonds → FUND
 * 4. otherwise → STOCK
 */
export type EstimatedAssetType = "STOCK" | "ETF" | "FUND" | "CERTIFICATE";

/** Words of a term are separated by whitespace or a hyphen in the name. */
export function termPattern(terms: readonly string[]): RegExp {
  const alternatives = terms.map((term) =>
    term
      .split(/[\s-]+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s-]*"),
  );
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

const RULES: readonly [RegExp, EstimatedAssetType][] = [
  [
    termPattern([
      "ETF",
      "ETC",
      "ETN",
      "UCITS ETF",
      "iShares",
      "Xtrackers",
      "Vanguard",
      "Amundi",
      "Lyxor",
      "SPDR",
      "Invesco",
      "WisdomTree",
    ]),
    "ETF",
  ],
  [termPattern(["Turbo", "Knock-Out", "Mini Future", "Optionsschein", "Open End"]), "CERTIFICATE"],
  [termPattern(["SICAV", "Fund", "Funds", "Fonds"]), "FUND"],
];

/** The estimated asset type of a Security named `name` (never CRYPTO or UNCLASSIFIED). */
export function classifySecurityName(name: string): EstimatedAssetType {
  for (const [pattern, type] of RULES) if (pattern.test(name)) return type;
  return "STOCK";
}
