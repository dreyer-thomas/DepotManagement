// Shared readers of the finanzen.net zero / Baader Bank parsers (story 5.5): the issuer check and the
// signed position lines ("<label> <amount>EUR", "<label> <amount> -EUR"; a trailing "-" makes the value
// negative). Baader signs them relative to the direction of the Kurswert / Bruttobetrag; the parsers
// turn the sums into fee and tax.
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { germanAmount } from "../german";
import { foreignCurrencyReason, unsupportedPositionReason } from "./reasons";

/** Every Baader Bank document names its issuer. */
export function isBaaderDocument(text: string): boolean {
  return text.includes("Baader Bank");
}

/** Taxes: Kapitalertragsteuer, Solidaritätszuschlag, Kirchensteuer and any label ending in "Quellensteuer". */
function isTaxLabel(label: string): boolean {
  return /^(?:Kapitalertragsteuer|Solidaritätszuschlag|Kirchensteuer)$/.test(label) || /Quellensteuer$/.test(label);
}

/** Fee labels of a settlement ("Handelsplatzabhängige Gutschrift" is a credit, i.e. a negative fee). */
export const TRADE_FEE_LABEL = /^(?:Finanzkommission|Vermittlungsentgelt|Handelsplatzabhängige Gutschrift)(?:[ \t]|$)/;
/** Fee labels of a dividend credit. */
export const DIVIDEND_FEE_LABEL = /^Gebühren extern(?:[ \t]|$)/;

const POSITION_LINE = /^(\S.*?)[ \t]+(\d[\d.]*(?:,\d+)?)(?:[ \t]*(-))?[ \t]*([A-Z]{3})[ \t]*$/;

/** Sums of the signed position values (canonical decimal strings). */
export type PositionSums = { fees: string; taxes: string };

type Read<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Reads `lines` (the lines strictly between the start and end line of a position block) as signed EUR
 * position lines and sums fees and taxes. Any other label, a non-EUR value or an unreadable line fails.
 * `kind` names the document for the foreign-currency reason.
 */
export function readPositions(lines: readonly string[], feeLabel: RegExp, kind: "Abrechnung" | "Gutschrift"): Read<PositionSums> {
  let fees = new ExactDecimal(0);
  let taxes = new ExactDecimal(0);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    const match = POSITION_LINE.exec(line);
    if (!match) return { ok: false, message: unsupportedPositionReason(line) };
    const [, label, number, minus, currency] = match;
    const fee = feeLabel.test(label);
    if (!fee && !isTaxLabel(label)) return { ok: false, message: unsupportedPositionReason(label) };
    if (currency !== "EUR") return { ok: false, message: foreignCurrencyReason(kind, currency) };
    const amount = germanAmount(number);
    if (amount === null) return { ok: false, message: unsupportedPositionReason(label) };
    const value = minus ? new ExactDecimal(amount).negated() : new ExactDecimal(amount);
    if (fee) fees = fees.plus(value);
    else taxes = taxes.plus(value);
  }
  return { ok: true, value: { fees: canonicalDecimal(fees), taxes: canonicalDecimal(taxes) } };
}
