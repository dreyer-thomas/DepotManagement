// Deutsche Bank / ROBIN securities settlement ("Abrechnung: Kauf/Verkauf von Wertpapieren"). One proposal
// per Abrechnung section, so savings-plan and rebalancing documents with several executions yield one
// proposal per execution. Fee and tax are derived so that `core/cash` reproduces the booked total exactly.
// Two layouts: label-first ("Schlusstag 08.10.2026") and the value-first text unpdf extracts from real
// ROBIN PDFs, where each value is glued in front of its label ("16.03.2026Schlusstag", "310,27EURKurswert").
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { isinSchema, QUANTITY_MAX_DECIMALS, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import type { Parser, ParseError, TransactionProposalInput } from "../../proposal";
import { AMOUNT_PATTERN, DATE_PATTERN, germanAmount, germanDate, ISIN_PATTERN } from "../german";
import { foreignCurrencyReason, implausibleReason, missingFieldReason, STORNO_REASON } from "./reasons";

const SECTION_MARKER = /Abrechnung:\s*(Kauf|Verkauf)\s+von\s+Wertpapieren/g;
const STORNO = /Storno/i;

// Each field: label-first pattern, then the value-first (real unpdf) pattern. Named groups: date, isin,
// value, currency.
const TRADE_DATE = [
  new RegExp(String.raw`Schlusstag(?:\/-zeit)?(?:\s+MEZ)?\s+(?<date>${DATE_PATTERN})`),
  new RegExp(String.raw`(?<date>${DATE_PATTERN})Schlusstag`),
];
const ISIN = [
  new RegExp(String.raw`\bISIN\b[\s\S]{0,60}?\b(?<isin>${ISIN_PATTERN})\b`),
  new RegExp(String.raw`(?<isin>${ISIN_PATTERN})ISIN\b`),
];
// "Nominal ST 19", also "Nominal Ex-Tag" header with "ST 19" on the next line; value-first "3,1415STNominal".
const QUANTITY = [
  new RegExp(String.raw`Nominal(?:[ \t][^\n\d]*)?\s+ST\s+(?<value>${AMOUNT_PATTERN})`),
  new RegExp(String.raw`(?<value>${AMOUNT_PATTERN})STNominal`),
];
const PRICE = [
  new RegExp(String.raw`\bKurs\s+(?<currency>[A-Z]{3})\s+(?<value>${AMOUNT_PATTERN})`),
  new RegExp(String.raw`(?<value>${AMOUNT_PATTERN})(?<currency>[A-Z]{3})Kurs(?!wert)`),
];
const MARKET_VALUE = [
  new RegExp(String.raw`\bKurswert\s+(?<currency>[A-Z]{3})\s+(?<value>${AMOUNT_PATTERN})`),
  new RegExp(String.raw`(?<value>${AMOUNT_PATTERN})(?<currency>[A-Z]{3})Kurswert`),
];
// Value-first: the booked total sits on the line after "Belastung" (buy) or "Gutschrift" (sell).
const TOTAL = [
  new RegExp(String.raw`Buchung\s+auf\s+Kontonummer[\s\S]{0,120}?\b(?<currency>[A-Z]{3})\s+(?<value>${AMOUNT_PATTERN})`),
  new RegExp(String.raw`^[ \t]*(?:Belastung|Gutschrift)[ \t]*\n[ \t]*(?<value>${AMOUNT_PATTERN})(?<currency>[A-Z]{3})[ \t]*$`, "m"),
];
const TAX_LINE = new RegExp(
  String.raw`^[ \t]*(?:Kapitalertragsteuer|Solidaritätszuschlag|Kirchensteuer)(?:[ \t][^\n\d]*?)?\s+([A-Z]{3})\s+(${AMOUNT_PATTERN})`,
  "gm",
);
/** Every tax label line that carries a number (read or not). */
const TAX_LABEL_LINE = /^[ \t]*(?:Kapitalertragsteuer|Solidaritätszuschlag|Kirchensteuer)[^\n]*\d/gm;
// Value-first tax line ("4,48EURKapitalertragsteuer"): the printed amount is tax paid whatever its sign.
// The label must end there (no compound such as "Kapitalertragsteuerpflichtiger …").
const TAX_LABEL = String.raw`(?:Kapitalertragsteuer|Solidaritätszuschlag|Kirchensteuer)(?![A-Za-zÄÖÜäöüß])`;
const VALUE_FIRST_TAX_LINE = new RegExp(String.raw`^[ \t]*(${AMOUNT_PATTERN})[ \t]*([A-Z]{3})[ \t]*${TAX_LABEL}`, "gm");
/** Every line that starts with a number and names a tax (read or not); label-first lines start with the label. */
const VALUE_FIRST_TAX_LABEL_LINE = new RegExp(String.raw`^[ \t]*-?\s?\d[^\n]*?${TAX_LABEL}`, "gm");
// "Filialnummer Depotnummer Wertpapierbezeichnung Seite" header, then "123 4567890 00 <name> 1/1".
// Value-first: "1/1<name><Depotnummer> <Filialnummer>"; page "n/m" with single-digit m, seven-digit Depotnummer.
const NAME = [
  /Wertpapierbezeichnung[^\n]*\n[ \t]*\d+[ \t]+\d+[ \t]+\d+[ \t]+(?<name>\S[^\n]*?)(?:[ \t]+\d+\/\d+)?[ \t]*$/m,
  /^[ \t]*\d+\/\d(?<name>\S[^\n]*?)\d{7}[ \t]+\d+[ \t]*$/m,
];

/** Named groups of the first pattern that matches `text`, in order; `null` when none does. */
function firstMatch(text: string, patterns: readonly RegExp[]): Record<string, string> | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.groups) return match.groups;
  }
  return null;
}

/** Tolerance between Kurswert and quantity × price (prices may be printed rounded). */
const MIN_TOLERANCE = new ExactDecimal("0.05");
const RELATIVE_TOLERANCE = new ExactDecimal("0.005");

type SectionResult = { ok: true; proposal: TransactionProposalInput } | { ok: false; message: string };

function invalid(message: string): ParseError {
  return { error: "invalid", message };
}

/** Reads a currency and amount from the first matching pattern; a non-EUR currency fails the section. */
function readEur(
  section: string,
  patterns: readonly RegExp[],
  field: string,
  where: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const match = firstMatch(section, patterns);
  if (!match) return { ok: false, message: missingFieldReason(field, where) };
  if (match.currency !== "EUR") return { ok: false, message: foreignCurrencyReason("Abrechnung", match.currency, where) };
  const value = germanAmount(match.value);
  if (value === null) return { ok: false, message: missingFieldReason(field, where) };
  return { ok: true, value };
}

function parseSection(section: string, type: "BUY" | "SELL", where: string): SectionResult {
  const dateMatch = firstMatch(section, TRADE_DATE);
  const date = dateMatch ? germanDate(dateMatch.date) : null;
  if (date === null) return { ok: false, message: missingFieldReason("Schlusstag", where) };

  const isinMatch = firstMatch(section, ISIN);
  const isin = isinMatch ? isinSchema.safeParse(isinMatch.isin) : null;
  if (!isin?.success) return { ok: false, message: missingFieldReason("ISIN", where) };

  const quantityMatch = firstMatch(section, QUANTITY);
  const quantity = quantityMatch ? germanAmount(quantityMatch.value) : null;
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
  let valueFirstTax = new ExactDecimal(0);
  let valueFirstLines = 0;
  for (const match of section.matchAll(VALUE_FIRST_TAX_LINE)) {
    if (match[2] !== "EUR") return { ok: false, message: foreignCurrencyReason("Abrechnung", match[2], where) };
    const value = germanAmount(match[1]);
    if (value === null) return { ok: false, message: missingFieldReason("Steuerbetrag", where) };
    valueFirstTax = valueFirstTax.plus(new ExactDecimal(value).abs());
    valueFirstLines += 1;
  }
  if ((section.match(VALUE_FIRST_TAX_LABEL_LINE) ?? []).length !== valueFirstLines) {
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
  const tax = (type === "BUY" ? printedTax : printedTax.negated()).plus(valueFirstTax);
  const fee = type === "BUY" ? booked.minus(amount).minus(tax) : amount.minus(booked).minus(tax);
  if (fee.isNegative()) {
    return { ok: false, message: implausibleReason("Gebühren der Abrechnung nicht plausibel (Gutschriften übersteigen Gebühren)", where) };
  }

  const nameMatch = firstMatch(section, NAME);
  // The name is only a suggestion (AD-16): an over-long line is dropped rather than failing the document.
  const nameLine = nameMatch?.name.trim();
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
