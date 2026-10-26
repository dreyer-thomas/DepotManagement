// finanzen.net zero / Baader Bank Steuerausgleichsrechnung with an Erstattung: one standalone TAX with
// `amount 0` and `tax = −Erstattung` (a refund raises cash). The refunded tax lines after "Rückerstattung
// bereits gezahlter:" must add up to the Erstattung. The notice has no Valuta, so the date is the
// document date.
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import type { Parser, ParseError } from "../../proposal";
import { DATE_PATTERN, germanAmount, germanDate } from "../german";
import { isBaaderDocument } from "./positions";
import {
  foreignCurrencyReason,
  implausibleReason,
  missingFieldReason,
  STORNO_REASON,
  TAX_REFUND_SUM_REASON,
  TAX_REFUND_WITHOUT_REFUND_REASON,
} from "./reasons";

const UNSIGNED = String.raw`\d[\d.]*(?:,\d+)?`;
const TITLE = /^[ \t]*Steuerausgleichsrechnung[ \t]*$/m;
const STORNO = /Storno/i;
const REFUND = new RegExp(String.raw`^[ \t]*(${UNSIGNED})EURErstattung[ \t]*$`, "m");
const REFUND_HEADER = /^[ \t]*Rückerstattung bereits gezahlter:[ \t]*$/;
// "Kapitalertragsteuer Aktiengewinne EUR 12,00"
const REFUND_LINE = new RegExp(String.raw`^[ \t]*(\S[^\n]*?)[ \t]+([A-Z]{3})[ \t]+(${UNSIGNED})[ \t]*$`);
const SENTENCE = new RegExp(String.raw`in\s+Höhe\s+von\s+(${UNSIGNED})\s+EUR\b`);
const DOCUMENT_DATE = new RegExp(String.raw`^[ \t]*(${DATE_PATTERN})[ \t]*$`, "m");

function invalid(message: string): ParseError {
  return { error: "invalid", message };
}

/** Parses a Baader tax refund into one TAX proposal. */
export const parseFinanzenZeroTaxRefund: Parser = (text) => {
  if (!isBaaderDocument(text) || !TITLE.test(text)) return { error: "unrecognized" };
  if (STORNO.test(text)) return invalid(STORNO_REASON);

  const refundMatch = REFUND.exec(text);
  if (!refundMatch) return invalid(TAX_REFUND_WITHOUT_REFUND_REASON);
  const refundValue = germanAmount(refundMatch[1]);
  if (refundValue === null) return invalid(missingFieldReason("Erstattung"));
  const refund = new ExactDecimal(refundValue);
  if (!refund.greaterThan(0)) return invalid(TAX_REFUND_WITHOUT_REFUND_REASON);

  const lines = text.split("\n");
  const header = lines.findIndex((line) => REFUND_HEADER.test(line));
  if (header < 0) return invalid(missingFieldReason("Erstattete Steuern"));
  let sum = new ExactDecimal(0);
  for (const line of lines.slice(header + 1)) {
    const match = REFUND_LINE.exec(line);
    if (!match) break;
    if (match[2] !== "EUR") return invalid(foreignCurrencyReason("Abrechnung", match[2]));
    const value = germanAmount(match[3]);
    if (value === null) return invalid(missingFieldReason("Erstattete Steuern"));
    sum = sum.plus(value);
  }
  if (!sum.equals(refund)) return invalid(TAX_REFUND_SUM_REASON);

  const sentence = SENTENCE.exec(text);
  if (sentence) {
    const stated = germanAmount(sentence[1]);
    if (stated === null || !refund.equals(stated)) return invalid(implausibleReason("Erstattungsbetrag im Text weicht ab"));
  }

  const dateMatch = DOCUMENT_DATE.exec(text);
  const date = dateMatch ? germanDate(dateMatch[1]) : null;
  if (date === null) return invalid(missingFieldReason("Belegdatum"));

  return [{ type: "TAX", date, amount: "0", tax: canonicalDecimal(refund.negated()) }];
};
