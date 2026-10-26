// Deutsche Bank / ROBIN securities settlement ("Abrechnung: Kauf/Verkauf von Wertpapieren"). One proposal
// per Abrechnung section, so savings-plan and rebalancing documents with several executions yield one
// proposal per execution. Fee and tax are derived so that `core/cash` reproduces the booked total exactly.
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { isinSchema, QUANTITY_MAX_DECIMALS, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import type { Parser, ParseError, TransactionProposalInput } from "../../proposal";
import { AMOUNT_PATTERN, DATE_PATTERN, germanAmount, germanDate, ISIN_PATTERN } from "../german";
import { foreignCurrencyReason, implausibleReason, missingFieldReason, STORNO_REASON } from "./reasons";

const SECTION_MARKER = /Abrechnung:\s*(Kauf|Verkauf)\s+von\s+Wertpapieren/g;
const STORNO = /Storno/i;

const TRADE_DATE = new RegExp(String.raw`Schlusstag(?:\/-zeit)?(?:\s+MEZ)?\s+(${DATE_PATTERN})`);
const ISIN = new RegExp(String.raw`\bISIN\b[\s\S]{0,60}?\b(${ISIN_PATTERN})\b`);
// "Nominal ST 19", also "Nominal Ex-Tag" header with "ST 19" on the next line.
const QUANTITY = new RegExp(String.raw`Nominal(?:[ \t][^\n\d]*)?\s+ST\s+(${AMOUNT_PATTERN})`);
const PRICE = new RegExp(String.raw`\bKurs\s+([A-Z]{3})\s+(${AMOUNT_PATTERN})`);
const MARKET_VALUE = new RegExp(String.raw`\bKurswert\s+([A-Z]{3})\s+(${AMOUNT_PATTERN})`);
const TOTAL = new RegExp(String.raw`Buchung\s+auf\s+Kontonummer[\s\S]{0,120}?\b([A-Z]{3})\s+(${AMOUNT_PATTERN})`);
const TAX_LINE = new RegExp(
  String.raw`^[ \t]*(?:Kapitalertragsteuer|Solidaritätszuschlag|Kirchensteuer)(?:[ \t][^\n\d]*?)?\s+([A-Z]{3})\s+(${AMOUNT_PATTERN})`,
  "gm",
);
/** Every tax label line that carries a number (read or not). */
const TAX_LABEL_LINE = /^[ \t]*(?:Kapitalertragsteuer|Solidaritätszuschlag|Kirchensteuer)[^\n]*\d/gm;
// "Filialnummer Depotnummer Wertpapierbezeichnung Seite" header, then "123 4567890 00 <name> 1/1".
const NAME = /Wertpapierbezeichnung[^\n]*\n[ \t]*\d+[ \t]+\d+[ \t]+\d+[ \t]+(\S[^\n]*?)(?:[ \t]+\d+\/\d+)?[ \t]*$/m;

/** Tolerance between Kurswert and quantity × price (prices may be printed rounded). */
const MIN_TOLERANCE = new ExactDecimal("0.05");
const RELATIVE_TOLERANCE = new ExactDecimal("0.005");

type SectionResult = { ok: true; proposal: TransactionProposalInput } | { ok: false; message: string };

function invalid(message: string): ParseError {
  return { error: "invalid", message };
}

/** Reads `<currency> <amount>` from `pattern`; a non-EUR currency fails the section. */
function readEur(
  section: string,
  pattern: RegExp,
  field: string,
  where: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const match = pattern.exec(section);
  if (!match) return { ok: false, message: missingFieldReason(field, where) };
  if (match[1] !== "EUR") return { ok: false, message: foreignCurrencyReason("Abrechnung", match[1], where) };
  const value = germanAmount(match[2]);
  if (value === null) return { ok: false, message: missingFieldReason(field, where) };
  return { ok: true, value };
}

function parseSection(section: string, type: "BUY" | "SELL", where: string): SectionResult {
  const dateMatch = TRADE_DATE.exec(section);
  const date = dateMatch ? germanDate(dateMatch[1]) : null;
  if (date === null) return { ok: false, message: missingFieldReason("Schlusstag", where) };

  const isinMatch = ISIN.exec(section);
  const isin = isinMatch ? isinSchema.safeParse(isinMatch[1]) : null;
  if (!isin?.success) return { ok: false, message: missingFieldReason("ISIN", where) };

  const quantityMatch = QUANTITY.exec(section);
  const quantity = quantityMatch ? germanAmount(quantityMatch[1]) : null;
  if (quantity === null) return { ok: false, message: missingFieldReason("Stückzahl", where) };

  const price = readEur(section, PRICE, "Kurs", where);
  if (!price.ok) return price;
  const marketValue = readEur(section, MARKET_VALUE, "Kurswert", where);
  if (!marketValue.ok) return marketValue;
  const total = readEur(section, TOTAL, "Buchungsbetrag", where);
  if (!total.ok) return total;

  let printedTax = new ExactDecimal(0);
  let taxLines = 0;
  for (const match of section.matchAll(TAX_LINE)) {
    if (match[1] !== "EUR") return { ok: false, message: foreignCurrencyReason("Abrechnung", match[1], where) };
    const value = germanAmount(match[2]);
    if (value === null) return { ok: false, message: missingFieldReason("Steuerbetrag", where) };
    printedTax = printedTax.plus(value);
    // Counted like TAX_LABEL_LINE: only when the label line itself carries a number.
    if (/\d/.test(match[0].split("\n")[0])) taxLines += 1;
  }
  // A tax line with an amount that TAX_LINE cannot read must not silently end up in the fee.
  if ((section.match(TAX_LABEL_LINE) ?? []).length !== taxLines) {
    return { ok: false, message: missingFieldReason("Steuerbetrag", where) };
  }

  const qty = new ExactDecimal(quantity);
  const unitPrice = new ExactDecimal(price.value);
  const amount = new ExactDecimal(marketValue.value);
  // The booked total's sign carries no meaning beyond the direction, which comes from the type.
  const booked = new ExactDecimal(total.value).abs();
  if (!qty.greaterThan(0) || qty.decimalPlaces() > QUANTITY_MAX_DECIMALS) {
    return { ok: false, message: missingFieldReason("Stückzahl", where) };
  }
  if (!unitPrice.greaterThan(0) || !amount.greaterThan(0) || !booked.greaterThan(0)) {
    return { ok: false, message: implausibleReason("Kurs, Kurswert oder Buchungsbetrag nicht plausibel", where) };
  }
  const deviation = qty.times(unitPrice).minus(amount).abs();
  if (deviation.greaterThan(ExactDecimal.max(MIN_TOLERANCE, amount.times(RELATIVE_TOLERANCE)))) {
    return { ok: false, message: implausibleReason("Kurswert passt nicht zu Stückzahl und Kurs", where) };
  }

  // BUY: taxes as printed. SELL: printed negative = paid, so the sign is inverted (AD-14: positive = paid).
  const tax = type === "BUY" ? printedTax : printedTax.negated();
  const fee = type === "BUY" ? booked.minus(amount).minus(tax) : amount.minus(booked).minus(tax);
  if (fee.isNegative()) {
    return { ok: false, message: implausibleReason("Gebühren der Abrechnung nicht plausibel (Gutschriften übersteigen Gebühren)", where) };
  }

  const nameMatch = NAME.exec(section);
  // The name is only a suggestion (AD-16): an over-long line is dropped rather than failing the document.
  const nameLine = nameMatch?.[1].trim();
  const name = nameLine && nameLine.length <= SECURITY_NAME_MAX_LENGTH ? nameLine : undefined;
  return {
    ok: true,
    proposal: {
      type,
      date,
      isin: isin.data,
      ...(name ? { name } : {}),
      quantity: canonicalDecimal(qty),
      price: canonicalDecimal(unitPrice),
      amount: canonicalDecimal(amount),
      fee: canonicalDecimal(fee),
      tax: canonicalDecimal(tax),
    },
  };
}

/** Parses a ROBIN "Abrechnung: Kauf/Verkauf von Wertpapieren"; all sections or nothing. */
export const parseDeutscheBankTrade: Parser = (text) => {
  const markers = [...text.matchAll(SECTION_MARKER)];
  if (markers.length === 0) return { error: "unrecognized" };
  if (STORNO.test(text)) return invalid(STORNO_REASON);

  const proposals: TransactionProposalInput[] = [];
  for (const [index, marker] of markers.entries()) {
    const end = index + 1 < markers.length ? markers[index + 1].index : text.length;
    const section = text.slice(marker.index, end);
    const where = markers.length > 1 ? ` (Abrechnung ${index + 1})` : "";
    const result = parseSection(section, marker[1] === "Kauf" ? "BUY" : "SELL", where);
    if (!result.ok) return invalid(result.message);
    proposals.push(result.proposal);
  }
  return proposals;
};
