// German reasons of the finanzen.net zero / Baader Bank parsers (story 5.5). Failure reasons end with the
// manual-entry hint, except the corporate-action reason, which points to the Corporate Action form.
import { MANUAL } from "../reasons";

export { foreignCurrencyReason, implausibleReason, missingFieldReason, STORNO_REASON } from "../reasons";

/** Info of a document that changes no account (tax-pot notice). */
export const NO_BOOKING_INFO = "Keine Buchung erforderlich.";

/** A corporate-action notice (ISIN change, split, merger, …): never booked as a trade. */
export const CORPORATE_ACTION_REASON = "Kapitalmaßnahme bitte als Corporate Action erfassen.";

/** A position line whose label is neither a known fee nor a known tax. */
export function unsupportedPositionReason(label: string): string {
  return `Position „${label}“ wird nicht unterstützt. ${MANUAL}`;
}

/** A settlement with more than one execution line (partial fills share one fee block). */
export const PARTIAL_FILLS_REASON = `Mehrere Teilausführungen werden nicht unterstützt. ${MANUAL}`;

/** The booked account total of a settlement does not match Kurswert, fees and taxes. */
export const TRADE_TOTAL_REASON = `Abrechnungsbetrag stimmt nicht mit Kurswert, Gebühren und Steuern überein. ${MANUAL}`;

/** The credited amount of a dividend does not match gross amount, fees and taxes. */
export const DIVIDEND_TOTAL_REASON = `Gutschriftsbetrag stimmt nicht mit Bruttobetrag, Gebühren und Steuern überein. ${MANUAL}`;

/** Credits (e.g. Handelsplatzabhängige Gutschrift) exceed the fees: a net fee credit cannot be booked. */
export const NET_FEE_CREDIT_REASON = `Gutschriften übersteigen die Gebühren. ${MANUAL}`;

/** A Steuerausgleichsrechnung without an Erstattung (e.g. a debit). */
export const TAX_REFUND_WITHOUT_REFUND_REASON = `Steuerausgleichsrechnung ohne Erstattung wird nicht unterstützt. ${MANUAL}`;

/** The refunded tax lines do not add up to the Erstattung. */
export const TAX_REFUND_SUM_REASON = `Erstattete Steuern ergeben nicht den Erstattungsbetrag. ${MANUAL}`;

/** A tax-pot notice that also moves money on the account. */
export const TAX_POT_WITH_POSTING_REASON = `Steuertopf-Mitteilung mit Kontobuchung wird nicht unterstützt. ${MANUAL}`;
