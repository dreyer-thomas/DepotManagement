// Query terms for news searches (AD-17): derived from the Security name only (never ISIN or ledger data).

/** Trailing legal-form tokens, compared case-insensitively with dots removed (`N.V.` → `nv`). */
const LEGAL_FORMS = new Set([
  "ag",
  "se",
  "kgaa",
  "gmbh",
  "inc",
  "corp",
  "corporation",
  "plc",
  "nv",
  "sa",
  "ltd",
  "co",
  "holding",
  "holdings",
  "kg",
  "llc",
  "a/s",
  "asa",
  "ab",
  "oyj",
  "spa",
  "aktiengesellschaft",
  "limited",
]);

const TRAILING_PUNCTUATION = /[\s.,&]+$/;

/**
 * The search term of a Security name: trailing legal-form tokens stripped repeatedly (with trailing `.`, `,`,
 * `&` and extra spaces), e.g. "Henkel AG & Co. KGaA" → "Henkel", "SAP SE" → "SAP". An empty result
 * falls back to the original name.
 */
export function newsTerm(name: string): string {
  let term = name.replace(/\s+/g, " ").trim().replace(TRAILING_PUNCTUATION, "");
  for (;;) {
    const space = term.lastIndexOf(" ");
    const last = term.slice(space + 1);
    if (!LEGAL_FORMS.has(last.replace(/\./g, "").toLowerCase())) break;
    term = (space < 0 ? "" : term.slice(0, space)).replace(TRAILING_PUNCTUATION, "");
  }
  return term || name.trim();
}

/** Asset types whose Yahoo symbol has a headline feed with teasers (ETFs, funds and certificates do not). */
const RSS_ASSET_TYPES = new Set(["STOCK", "UNCLASSIFIED", "CRYPTO"]);

/** The fields of a Security that decide its Yahoo symbol. */
export type YahooSymbolSource = {
  assetType: string;
  cryptoSymbol: string | null;
  mapping: { provider: string | null; symbol: string | null } | null;
};

/**
 * The Yahoo symbol whose RSS feed is read for a Security, or `undefined` when it is not queried: the YAHOO
 * mapping symbol for STOCK and UNCLASSIFIED; for CRYPTO the YAHOO mapping symbol if any, else
 * `<SYMBOL>-EUR` from the crypto symbol (Yahoo's crypto ticker convention).
 */
export function yahooSymbol(security: YahooSymbolSource): string | undefined {
  if (!RSS_ASSET_TYPES.has(security.assetType)) return undefined;
  const mapped = security.mapping?.provider === "YAHOO" ? (security.mapping.symbol ?? "").trim() : "";
  if (mapped) return mapped;
  if (security.assetType === "CRYPTO" && security.cryptoSymbol?.trim()) return `${security.cryptoSymbol.trim().toUpperCase()}-EUR`;
  return undefined;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `word` as a whole word of `text` (Unicode letters and digits are word characters). */
function containsWord(text: string, word: string, flags: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, flags).test(text);
}

/**
 * True when the text (title and teaser of an RSS item) mentions the Security: its news term (`newsTerm`)
 * case-insensitively as a whole word, or the symbol base (part before the first `.` or `-`, `SAP.DE` →
 * `SAP`) case-sensitively as a whole word.
 */
export function mentionsSecurity(text: string, name: string, symbol: string): boolean {
  const term = newsTerm(name);
  if (term && containsWord(text, term, "iu")) return true;
  const base = symbol.split(/[.-]/)[0].trim();
  return base !== "" && containsWord(text, base, "u");
}
