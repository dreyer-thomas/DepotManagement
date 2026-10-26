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
