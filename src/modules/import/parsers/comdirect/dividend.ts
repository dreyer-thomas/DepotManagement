// comdirect / cominvest dividend or distribution credit ("Ertragsgutschrift" / "Dividendengutschrift" with
// "Bruttobetrag:"). The credit prints only the amount "vor Steuern"; German taxes come with a separate
// Steuermitteilung (same Referenz-Nr.) that `linkDocuments` merges in when both are in one upload.
// Until then `tax` = gross − "vor Steuern" (foreign withholding tax deducted on the credit; 0 without).
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { isinSchema, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import type { Parser } from "../../proposal";
import { AMOUNT_PATTERN, DATE_PATTERN, germanAmount, germanDate, ISIN_PATTERN } from "../german";
import { creditWithoutNoticeNote, foreignCurrencyReason, implausibleReason, missingFieldReason, STORNO_REASON } from "./reasons";

const TITLE = /Ertragsgutschrift|Dividendengutschrift/;
const GROSS_LABEL = /Bruttobetrag:/;
const STORNO = /Storno/i;

const PAYABLE = new RegExp(String.raw`zahlbar\s+ab\s+(${DATE_PATTERN})`);
// "STK 120 IE00B3RBWM25Registered Shares …": the name continues right after the ISIN.
const SECURITY = new RegExp(String.raw`^[ \t]*STK[ \t]+${AMOUNT_PATTERN}[ \t]+(${ISIN_PATTERN})`, "m");
// "per 29.05.2026 A1JX52Vanguard FTSE All-World UCITS ETF": WKN glued to the name.
const NAME = new RegExp(String.raw`^[ \t]*per[ \t]+${DATE_PATTERN}[ \t]+[A-Z0-9]{6}(\S[^\n]*?)[ \t]*$`, "m");
const GROSS = new RegExp(String.raw`Bruttobetrag:\s*([A-Z]{3})\s+(${AMOUNT_PATTERN})`);
// "zum Devisenkurs: EUR/USD 1,173300 EUR 25,57": the EUR value of a foreign-currency gross amount.
const CONVERTED = new RegExp(String.raw`zum\s+Devisenkurs:[^\n]*?\bEUR[ \t]+(${AMOUNT_PATTERN})[ \t]*$`, "m");
// "… Zu Ihren Gunsten vor Steuern", then "<IBAN> EUR <Valuta> EUR <amount>".
const BEFORE_TAX_HEADER = /Zu Ihren Gunsten vor Steuern[ \t]*\n([^\n]*)/;
const CURRENCY_AMOUNT = new RegExp(String.raw`\b([A-Z]{3})[ \t]+(${AMOUNT_PATTERN})`, "g");
const REFERENCE = /Referenz-Nr\.\s*([A-Z0-9]+)/;

/** Parses a comdirect dividend credit into one DIVIDEND proposal with a `dividend-credit` link. */
export const parseComdirectDividend: Parser = (text) => {
  if (!TITLE.test(text) || !GROSS_LABEL.test(text)) return { error: "unrecognized" };
  if (STORNO.test(text)) return { error: "invalid", message: STORNO_REASON };

  const payable = PAYABLE.exec(text);
  const date = payable ? germanDate(payable[1]) : null;
  if (date === null) return { error: "invalid", message: missingFieldReason("Zahltag") };

  const security = SECURITY.exec(text);
  const isin = security ? isinSchema.safeParse(security[1]) : null;
  if (!isin?.success) return { error: "invalid", message: missingFieldReason("ISIN") };

  const grossMatch = GROSS.exec(text);
  if (!grossMatch) return { error: "invalid", message: missingFieldReason("Bruttobetrag") };
  let gross: string | null;
  if (grossMatch[1] === "EUR") {
    gross = germanAmount(grossMatch[2]);
  } else {
    const converted = CONVERTED.exec(text);
    if (!converted) return { error: "invalid", message: foreignCurrencyReason("Gutschrift", grossMatch[1]) };
    gross = germanAmount(converted[1]);
  }
  if (gross === null) return { error: "invalid", message: missingFieldReason("Bruttobetrag") };

  const beforeHeader = BEFORE_TAX_HEADER.exec(text);
  const beforePair = beforeHeader ? [...beforeHeader[1].matchAll(CURRENCY_AMOUNT)].at(-1) : undefined;
  if (!beforePair) return { error: "invalid", message: missingFieldReason("Betrag vor Steuern") };
  if (beforePair[1] !== "EUR") return { error: "invalid", message: foreignCurrencyReason("Gutschrift", beforePair[1]) };
  const before = germanAmount(beforePair[2]);
  if (before === null) return { error: "invalid", message: missingFieldReason("Betrag vor Steuern") };

  const reference = REFERENCE.exec(text)?.[1];
  if (!reference) return { error: "invalid", message: missingFieldReason("Referenz-Nr.") };

  const amount = new ExactDecimal(gross);
  const beforeTax = new ExactDecimal(before);
  if (!amount.greaterThan(0) || beforeTax.isNegative() || beforeTax.greaterThan(amount)) {
    return { error: "invalid", message: implausibleReason("Bruttobetrag oder Betrag vor Steuern nicht plausibel") };
  }

  // The name is only a suggestion (AD-16): an over-long line is dropped rather than failing the document.
  const nameLine = NAME.exec(text)?.[1]?.trim();
  const name = nameLine && nameLine.length <= SECURITY_NAME_MAX_LENGTH ? nameLine : undefined;
  return {
    proposals: [
      {
        type: "DIVIDEND",
        date,
        isin: isin.data,
        ...(name ? { name } : {}),
        amount: canonicalDecimal(amount),
        tax: canonicalDecimal(amount.minus(beforeTax)),
      },
    ],
    note: creditWithoutNoticeNote(reference),
    link: { kind: "dividend-credit", reference, beforeTax: canonicalDecimal(beforeTax) },
  };
};
