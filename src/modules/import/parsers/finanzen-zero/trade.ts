// finanzen.net zero / Baader Bank securities settlement ("Wertpapierabrechnung: Kauf|Verkauf"). Baader
// signs the position lines relative to the Kurswert: the booked total is Kurswert + Σ position values in
// both directions, so on a sell fee and tax flip sign. The account total must equal the cash effect of the
// proposal. A document with several executions (partial fills sharing one fee block) is not read.
import { cashEffect } from "@/core/cash";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { isinSchema, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import type { Parser, ParseError } from "../../proposal";
import { DATE_PATTERN, germanAmount, germanDate, ISIN_PATTERN } from "../german";
import { isBaaderDocument, readPositions, TRADE_FEE_LABEL } from "./positions";
import {
  foreignCurrencyReason,
  implausibleReason,
  missingFieldReason,
  NET_FEE_CREDIT_REASON,
  PARTIAL_FILLS_REASON,
  STORNO_REASON,
  TRADE_TOTAL_REASON,
} from "./reasons";

const UNSIGNED = String.raw`\d[\d.]*(?:,\d+)?`;
const TITLE = /^[ \t]*Wertpapierabrechnung:[ \t]*(Kauf|Verkauf)[ \t]*$/m;
const STORNO = /Storno/i;
const ISIN = new RegExp(String.raw`ISIN:[ \t]*(${ISIN_PATTERN})\b`);
// "STK 12 Siemens AG": the Nominale line with the Security name.
const NOMINAL = new RegExp(String.raw`^[ \t]*STK[ \t]+(${UNSIGNED})[ \t]+(\S[^\n]*?)[ \t]*$`, "m");
// "GETTEX - MM Munich 15.04.2026STK 12 EUR 180,50 09:12:30:415": Handelsdatum glued to the quantity.
const EXECUTION = new RegExp(String.raw`(${DATE_PATTERN})STK[ \t]+(${UNSIGNED})[ \t]+([A-Z]{3})[ \t]+(${UNSIGNED})[ \t]+\d{2}:\d{2}`, "g");
// "EURKurswert 2.166,00": start of the position block.
const MARKET_VALUE = new RegExp(String.raw`^[ \t]*([A-Z]{3})Kurswert[ \t]+(${UNSIGNED})[ \t]*$`);
// "Valuta: 17.04.2026Zu Lasten Konto 1234567006 EUR 2.166,00": end of the position block.
const TOTAL = new RegExp(String.raw`Zu[ \t]+(Lasten|Gunsten)[ \t]+Konto[ \t]+\S+[ \t]+([A-Z]{3})[ \t]+(${UNSIGNED})[ \t]*$`);

/** Largest accepted difference between quantity × price and the Kurswert. */
const TOLERANCE = new ExactDecimal("0.01");

function invalid(message: string): ParseError {
  return { error: "invalid", message };
}

/** Parses a Baader settlement into one BUY or SELL proposal. */
export const parseFinanzenZeroTrade: Parser = (text) => {
  const title = TITLE.exec(text);
  if (!isBaaderDocument(text) || !title) return { error: "unrecognized" };
  if (STORNO.test(text)) return invalid(STORNO_REASON);
  const type = title[1] === "Kauf" ? "BUY" : "SELL";

  const isinMatch = ISIN.exec(text);
  const isin = isinMatch ? isinSchema.safeParse(isinMatch[1]) : null;
  if (!isin?.success) return invalid(missingFieldReason("ISIN"));

  const nominal = NOMINAL.exec(text);
  const nominalQuantity = nominal ? germanAmount(nominal[1]) : null;
  if (!nominal || nominalQuantity === null) return invalid(missingFieldReason("Nominale"));

  const executions = [...text.matchAll(EXECUTION)];
  if (executions.length > 1) return invalid(PARTIAL_FILLS_REASON);
  const [execution] = executions;
  if (!execution) return invalid(missingFieldReason("Ausführung"));
  const date = germanDate(execution[1]);
  if (date === null) return invalid(missingFieldReason("Handelsdatum"));
  if (execution[3] !== "EUR") return invalid(foreignCurrencyReason("Abrechnung", execution[3]));
  const quantity = germanAmount(execution[2]);
  const price = germanAmount(execution[4]);
  if (quantity === null) return invalid(missingFieldReason("Stückzahl"));
  if (price === null) return invalid(missingFieldReason("Kurs"));
  if (!new ExactDecimal(quantity).equals(nominalQuantity)) {
    return invalid(implausibleReason("Stückzahl der Ausführung passt nicht zur Nominale"));
  }

  const lines = text.split("\n");
  const start = lines.findIndex((line) => MARKET_VALUE.test(line));
  if (start < 0) return invalid(missingFieldReason("Kurswert"));
  const marketValue = MARKET_VALUE.exec(lines[start]) as RegExpExecArray;
  if (marketValue[1] !== "EUR") return invalid(foreignCurrencyReason("Abrechnung", marketValue[1]));
  const amount = germanAmount(marketValue[2]);
  if (amount === null) return invalid(missingFieldReason("Kurswert"));
  const endOffset = lines.slice(start + 1).findIndex((line) => TOTAL.test(line));
  if (endOffset < 0) return invalid(missingFieldReason("Abrechnungsbetrag"));
  const end = start + 1 + endOffset;
  const total = TOTAL.exec(lines[end]) as RegExpExecArray;
  if (total[2] !== "EUR") return invalid(foreignCurrencyReason("Abrechnung", total[2]));
  const totalValue = germanAmount(total[3]);
  if (totalValue === null) return invalid(missingFieldReason("Abrechnungsbetrag"));

  if (new ExactDecimal(quantity).times(price).minus(amount).abs().greaterThan(TOLERANCE)) {
    return invalid(implausibleReason("Kurswert passt nicht zu Stückzahl und Kurs"));
  }

  const positions = readPositions(lines.slice(start + 1, end), TRADE_FEE_LABEL, "Abrechnung");
  if (!positions.ok) return invalid(positions.message);
  const sign = type === "BUY" ? 1 : -1;
  const fee = new ExactDecimal(positions.value.fees).times(sign);
  const tax = new ExactDecimal(positions.value.taxes).times(sign);
  if (fee.lessThan(0)) return invalid(NET_FEE_CREDIT_REASON);

  const proposal = {
    type,
    date,
    isin: isin.data,
    quantity,
    price,
    amount,
    fee: canonicalDecimal(fee),
    tax: canonicalDecimal(tax),
  } as const;
  const debit = total[1] === "Lasten";
  const expected = type === "BUY" ? new ExactDecimal(totalValue).negated() : new ExactDecimal(totalValue);
  if (debit !== (type === "BUY") || !expected.equals(cashEffect(proposal))) return invalid(TRADE_TOTAL_REASON);

  // The name is only a suggestion (AD-16): an over-long line is dropped rather than failing the document.
  const name = nominal[2].length <= SECURITY_NAME_MAX_LENGTH ? nominal[2] : undefined;
  return [{ ...proposal, ...(name ? { name } : {}) }];
};
