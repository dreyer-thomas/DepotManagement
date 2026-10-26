// finanzen.net zero / Baader Bank dividend or fund distribution ("Dividendenabrechnung",
// "Fondsausschüttung"). The position lines between "Bruttobetrag EUR" and the credited line are signed
// (a trailing "-" is deducted); the credited amount must equal the cash effect (gross − tax − fee). The
// tax summary pages ("Steuerbeträge", "Merkposten / Steuertöpfe") are never read.
import { cashEffect } from "@/core/cash";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { isinSchema, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import type { Parser, ParseError } from "../../proposal";
import { DATE_PATTERN, germanAmount, germanDate, ISIN_PATTERN } from "../german";
import { DIVIDEND_FEE_LABEL, isBaaderDocument, readPositions } from "./positions";
import {
  DIVIDEND_TOTAL_REASON,
  foreignCurrencyReason,
  missingFieldReason,
  NET_FEE_CREDIT_REASON,
  STORNO_REASON,
} from "./reasons";

const UNSIGNED = String.raw`\d[\d.]*(?:,\d+)?`;
const TITLE = /^[ \t]*(?:Dividendenabrechnung|Fondsausschüttung)[ \t]*$/m;
const STORNO = /Storno/i;
const PAY_DATE = new RegExp(String.raw`Zahltag:[ \t]*(${DATE_PATTERN})`);
const ISIN = new RegExp(String.raw`ISIN:[ \t]*(${ISIN_PATTERN})\b`);
// "USD 0,70 p.STKTaiwan Semiconductor Manufacturing Co. Ltd.": the name follows the per-share amount.
const NAME = /p\.STK[ \t]*(\S[^\n]*?)[ \t]*$/m;
const GROSS_EUR = new RegExp(String.raw`^[ \t]*Bruttobetrag[ \t]+EUR[ \t]+(${UNSIGNED})[ \t]*$`);
const GROSS_ANY = /Bruttobetrag[ \t]+([A-Z]{3})\b/;
// "4,52EURValuta: 10.07.2026Zu Gunsten Konto 1234567006": the credited amount.
const CREDITED = new RegExp(String.raw`^[ \t]*(${UNSIGNED})([A-Z]{3})Valuta:[^\n]*Zu[ \t]+Gunsten[ \t]+Konto`);

function invalid(message: string): ParseError {
  return { error: "invalid", message };
}

/** Parses a Baader dividend or fund distribution into one DIVIDEND proposal. */
export const parseFinanzenZeroDividend: Parser = (text) => {
  if (!isBaaderDocument(text) || !TITLE.test(text)) return { error: "unrecognized" };
  if (STORNO.test(text)) return invalid(STORNO_REASON);

  const payDate = PAY_DATE.exec(text);
  const date = payDate ? germanDate(payDate[1]) : null;
  if (date === null) return invalid(missingFieldReason("Zahltag"));

  const isinMatch = ISIN.exec(text);
  const isin = isinMatch ? isinSchema.safeParse(isinMatch[1]) : null;
  if (!isin?.success) return invalid(missingFieldReason("ISIN"));

  const lines = text.split("\n");
  const start = lines.findIndex((line) => GROSS_EUR.test(line));
  if (start < 0) {
    const currency = GROSS_ANY.exec(text)?.[1];
    return invalid(currency ? foreignCurrencyReason("Gutschrift", currency) : missingFieldReason("Bruttobetrag"));
  }
  const amount = germanAmount((GROSS_EUR.exec(lines[start]) as RegExpExecArray)[1]);
  if (amount === null) return invalid(missingFieldReason("Bruttobetrag"));
  const endOffset = lines.slice(start + 1).findIndex((line) => CREDITED.test(line));
  if (endOffset < 0) return invalid(missingFieldReason("Gutschriftsbetrag"));
  const end = start + 1 + endOffset;
  const credited = CREDITED.exec(lines[end]) as RegExpExecArray;
  if (credited[2] !== "EUR") return invalid(foreignCurrencyReason("Gutschrift", credited[2]));
  const creditedValue = germanAmount(credited[1]);
  if (creditedValue === null) return invalid(missingFieldReason("Gutschriftsbetrag"));

  const positions = readPositions(lines.slice(start + 1, end), DIVIDEND_FEE_LABEL, "Gutschrift");
  if (!positions.ok) return invalid(positions.message);
  const fee = new ExactDecimal(positions.value.fees).negated();
  const tax = new ExactDecimal(positions.value.taxes).negated();
  if (fee.lessThan(0)) return invalid(NET_FEE_CREDIT_REASON);

  const proposal = { type: "DIVIDEND", date, isin: isin.data, amount, fee: canonicalDecimal(fee), tax: canonicalDecimal(tax) } as const;
  if (!new ExactDecimal(creditedValue).equals(cashEffect(proposal))) return invalid(DIVIDEND_TOTAL_REASON);

  // The name is only a suggestion (AD-16): an over-long line is dropped rather than failing the document.
  const nameLine = NAME.exec(text)?.[1];
  const name = nameLine && nameLine.length <= SECURITY_NAME_MAX_LENGTH ? nameLine : undefined;
  return [{ ...proposal, ...(name ? { name } : {}) }];
};
