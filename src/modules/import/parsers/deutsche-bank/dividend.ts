// Deutsche Bank / ROBIN dividend or distribution credit ("Dividendengutschrift" / "Ertragsgutschrift").
// Amounts are printed as `<amount> <currency>`, a foreign-currency column may precede the EUR column.
// `tax` = gross − credit, covering withholding tax, KESt, Soli and KiSt (negative = refund).
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { isinSchema, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import type { Parser } from "../../proposal";
import { AMOUNT_PATTERN, DATE_PATTERN, germanAmount, germanDate, ISIN_PATTERN } from "../german";
import { foreignCurrencyReason, implausibleReason, missingFieldReason, STORNO_REASON } from "./reasons";

const TITLE = /Dividendengutschrift|Ertragsgutschrift/;
const GROSS_LABEL = /Bruttoertrag/;
const STORNO = /Storno/i;
/** A line after the ISIN that is a label, not the Security name (name line missing). */
const NOT_A_NAME = /^(?:Zahlbar|Bruttoertrag|Gutschrift)\b/;

const PAYABLE = new RegExp(String.raw`Zahlbar\s+(${DATE_PATTERN})`);
// "Stück WKN ISIN" header, then "<quantity> <WKN> <ISIN>" and the Security name on the next line.
const SECURITY = new RegExp(
  String.raw`Stück\s+WKN\s+ISIN\s+${AMOUNT_PATTERN}\s+\S+\s+(${ISIN_PATTERN})\b[ \t]*(?:\n[ \t]*([^\n]*\S))?`,
);
// Up to two `<amount> <currency>` columns after the label.
const VALUE_COLUMN = String.raw`(${AMOUNT_PATTERN})\s+([A-Z]{3})\b`;
const GROSS = new RegExp(String.raw`Bruttoertrag\s+${VALUE_COLUMN}(?:\s+${VALUE_COLUMN})?`);
const CREDIT = new RegExp(String.raw`Gutschrift\s+mit\s+Wert\s+${DATE_PATTERN}\s+${VALUE_COLUMN}(?:\s+${VALUE_COLUMN})?`);

type Column = { ok: true; value: string } | { ok: false; message: string };

/** The EUR column of a matched `<amount> <currency>` pair list; no EUR column fails as foreign currency. */
function eurColumn(match: RegExpExecArray | null, field: string): Column {
  if (!match) return { ok: false, message: missingFieldReason(field) };
  const columns: Array<[string, string]> = [[match[1], match[2]]];
  if (match[3] !== undefined && match[4] !== undefined) columns.push([match[3], match[4]]);
  const eur = columns.find(([, currency]) => currency === "EUR");
  if (!eur) return { ok: false, message: foreignCurrencyReason("Gutschrift", columns[0][1]) };
  const value = germanAmount(eur[0]);
  if (value === null) return { ok: false, message: missingFieldReason(field) };
  return { ok: true, value };
}

/** Parses a ROBIN dividend/distribution credit into one DIVIDEND proposal. */
export const parseDeutscheBankDividend: Parser = (text) => {
  if (!TITLE.test(text) || !GROSS_LABEL.test(text)) return { error: "unrecognized" };
  if (STORNO.test(text)) return { error: "invalid", message: STORNO_REASON };

  const payable = PAYABLE.exec(text);
  const date = payable ? germanDate(payable[1]) : null;
  if (date === null) return { error: "invalid", message: missingFieldReason("Zahltag") };

  const security = SECURITY.exec(text);
  const isin = security ? isinSchema.safeParse(security[1]) : null;
  if (!isin?.success) return { error: "invalid", message: missingFieldReason("ISIN") };

  const gross = eurColumn(GROSS.exec(text), "Bruttoertrag");
  if (!gross.ok) return { error: "invalid", message: gross.message };
  const credit = eurColumn(CREDIT.exec(text), "Gutschriftsbetrag");
  if (!credit.ok) return { error: "invalid", message: credit.message };

  const amount = new ExactDecimal(gross.value);
  const credited = new ExactDecimal(credit.value);
  if (!amount.greaterThan(0) || credited.isNegative()) {
    return { error: "invalid", message: implausibleReason("Bruttoertrag oder Gutschrift nicht plausibel") };
  }

  const nameLine = security?.[2]?.trim();
  // The name is only a suggestion (AD-16): a label or over-long line is dropped rather than failing the document.
  const name = nameLine && !NOT_A_NAME.test(nameLine) && nameLine.length <= SECURITY_NAME_MAX_LENGTH ? nameLine : undefined;
  return [
    {
      type: "DIVIDEND",
      date,
      isin: isin.data,
      ...(name ? { name } : {}),
      amount: canonicalDecimal(amount),
      tax: canonicalDecimal(amount.minus(credited)),
    },
  ];
};
