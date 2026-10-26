// comdirect Steuermitteilung ("Steuerliche Behandlung: …"): the tax part of a settlement document and the
// separate tax notice of a dividend credit. `readTaxNotice` reads one notice part for both parsers;
// `parseComdirectDividendTax` turns a standalone dividend notice into a link that `linkDocuments` merges
// into its Ertragsgutschrift (same Referenz-Nummer, same upload).
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { isinSchema } from "@/modules/ledger";
import type { Parser } from "../../proposal";
import { AMOUNT_PATTERN, germanAmount, ISIN_PATTERN } from "../german";
import {
  foreignCurrencyReason,
  missingFieldReason,
  noticeArithmeticReason,
  STORNO_REASON,
  TRADE_NOTICE_WITHOUT_SETTLEMENT_REASON,
} from "./reasons";

/** Start of a notice part; group 1 is the rest of the header line ("Wertpapierkauf Nr. 91000001 vom …"). */
export const NOTICE_MARKER = /Steuerliche Behandlung:([^\n]*)/;
const STORNO = /Storno/i;
/** A trade notice names the trade ("Wertpapierkauf", "Verkauf Investmentfonds") in its header. */
const TRADE_HEADER = /kauf/i;
/** A dividend notice names a distribution in its header; other notices (e.g. Vorabpauschale) are not read. */
const DISTRIBUTION_HEADER = /Ausschüttung|Dividende|Ertrag/i;
const NUMBER = /\bNr\.\s*(\d[\d ]*\d|\d)/;
const ISIN = new RegExp(String.raw`WKN\s*\/\s*ISIN:\s*\S+\s*\/\s*(${ISIN_PATTERN})\b`);
const BEFORE_TAX = new RegExp(String.raw`Zu\s+Ihren\s+(?:Lasten|Gunsten)\s+vor\s+Steuern:\s*([A-Z]{3})\s+(${AMOUNT_PATTERN})`);
const WITHHELD = new RegExp(String.raw`abgeführte\s+Steuern\s+([A-Z]{3})\s+(${AMOUNT_PATTERN})`);
const AFTER_TAX = new RegExp(String.raw`Zu\s+Ihren\s+(?:Lasten|Gunsten)\s+nach\s+Steuern:\s*([A-Z]{3})\s+(${AMOUNT_PATTERN})`);
const REFERENCE = /Referenz-Nummer:\s*([A-Z0-9]+)/;

/** One notice part; amounts are canonical decimal strings, signed as printed (withheld negative = paid). */
export type TaxNotice = {
  /** Header after "Steuerliche Behandlung:". */
  header: string;
  /** Digits of "Nr. …" in the header (the settlement's Geschäftsnummer); `null` without one. */
  number: string | null;
  isin: string;
  beforeTax: string;
  withheld: string;
  afterTax: string;
};

type Read<T> = { ok: true; value: T } | { ok: false; message: string };

function readEur(part: string, pattern: RegExp, field: string, where: string): Read<string> {
  const match = pattern.exec(part);
  if (!match) return { ok: false, message: missingFieldReason(field, where) };
  if (match[1] !== "EUR") return { ok: false, message: foreignCurrencyReason("Steuermitteilung", match[1], where) };
  const value = germanAmount(match[2]);
  return value === null ? { ok: false, message: missingFieldReason(field, where) } : { ok: true, value };
}

/**
 * Reads a notice part starting at "Steuerliche Behandlung:" and checks `vor Steuern + abgeführte Steuern =
 * nach Steuern` (signed as printed). `where` names the settlement in multi-execution documents.
 */
export function readTaxNotice(part: string, where = ""): Read<TaxNotice> {
  const header = NOTICE_MARKER.exec(part)?.[1]?.trim() ?? "";
  const numberMatch = NUMBER.exec(header);
  const isinMatch = ISIN.exec(part);
  const isin = isinMatch ? isinSchema.safeParse(isinMatch[1]) : null;
  if (!isin?.success) return { ok: false, message: missingFieldReason("ISIN der Steuermitteilung", where) };
  const before = readEur(part, BEFORE_TAX, "Betrag vor Steuern", where);
  if (!before.ok) return before;
  const withheld = readEur(part, WITHHELD, "Abgeführte Steuern", where);
  if (!withheld.ok) return withheld;
  const after = readEur(part, AFTER_TAX, "Betrag nach Steuern", where);
  if (!after.ok) return after;
  if (!new ExactDecimal(before.value).plus(withheld.value).equals(after.value)) {
    return { ok: false, message: noticeArithmeticReason(where) };
  }
  return {
    ok: true,
    value: {
      header,
      number: numberMatch ? numberMatch[1].replace(/\D/g, "") : null,
      isin: isin.data,
      beforeTax: canonicalDecimal(before.value),
      withheld: canonicalDecimal(withheld.value),
      afterTax: canonicalDecimal(after.value),
    },
  };
}

/** Parses a standalone dividend Steuermitteilung into a `dividend-tax-notice` link without proposals. */
export const parseComdirectDividendTax: Parser = (text) => {
  const marker = NOTICE_MARKER.exec(text);
  if (!marker) return { error: "unrecognized" };
  if (TRADE_HEADER.test(marker[1])) return { error: "invalid", message: TRADE_NOTICE_WITHOUT_SETTLEMENT_REASON };
  if (!DISTRIBUTION_HEADER.test(marker[1])) return { error: "unrecognized" };
  if (STORNO.test(text)) return { error: "invalid", message: STORNO_REASON };

  const reference = REFERENCE.exec(text)?.[1];
  if (!reference) return { error: "invalid", message: missingFieldReason("Referenz-Nummer") };
  const notice = readTaxNotice(text.slice(marker.index));
  if (!notice.ok) return { error: "invalid", message: notice.message };
  const { isin, beforeTax, afterTax } = notice.value;
  return { proposals: [], link: { kind: "dividend-tax-notice", reference, isin, beforeTax, afterTax } };
};
