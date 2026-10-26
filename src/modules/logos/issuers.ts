// Certificate issuers (AD-19): a Security has no issuer field, so the issuer is recognised from the
// Security name and its logo is looked up by the issuer's listed-share ISIN.

/** Issuer name patterns (case-insensitive, word-bounded) → ISIN of the issuer's listed share. */
export const CERTIFICATE_ISSUERS: readonly { names: readonly string[]; isin: string }[] = [
  { names: ["UniCredit", "HypoVereinsbank", "HVB"], isin: "IT0005239360" },
  { names: ["Société Générale", "Societe Generale"], isin: "FR0000130809" },
  { names: ["Vontobel"], isin: "CH0012335540" },
  { names: ["Deutsche Bank"], isin: "DE0005140008" },
  { names: ["Commerzbank"], isin: "DE000CBK1001" },
  { names: ["BNP Paribas"], isin: "FR0000131104" },
  { names: ["Goldman Sachs", "Goldman"], isin: "US38141G1040" },
  { names: ["Morgan Stanley"], isin: "US6174464486" },
  { names: ["Citigroup", "Citi"], isin: "US1729674242" },
  { names: ["J.P. Morgan", "JPMorgan"], isin: "US46625H1005" },
  { names: ["UBS"], isin: "CH0244767585" },
  { names: ["HSBC"], isin: "GB0005405286" },
  { names: ["Xetra-Gold", "Deutsche Börse"], isin: "DE0005810055" },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-bounded (letters and digits, Unicode-aware), case-insensitive; spaces match any whitespace. */
function namePattern(name: string): RegExp {
  const body = escapeRegExp(name.normalize("NFC")).replace(/ /g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
}

const PATTERNS = CERTIFICATE_ISSUERS.map((issuer) => ({ isin: issuer.isin, patterns: issuer.names.map(namePattern) }));

/**
 * The issuer ISIN for a certificate named `name`, or `null` when no known issuer is named. When several
 * are named (issuer and underlying, e.g. "HSBC Turbo Long Deutsche Bank"), the earliest match wins.
 */
export function issuerIsin(name: string): string | null {
  const normalized = name.normalize("NFC");
  let best: { isin: string; index: number } | null = null;
  for (const { isin, patterns } of PATTERNS) {
    for (const pattern of patterns) {
      const index = normalized.search(pattern);
      if (index >= 0 && (best === null || index < best.index)) best = { isin, index };
    }
  }
  return best?.isin ?? null;
}
