// German reasons and review notes of the comdirect / cominvest parsers (story 5.4). Failure reasons end
// with the manual-entry hint unless they ask for another upload.
import { MANUAL } from "../reasons";

export { foreignCurrencyReason, implausibleReason, missingFieldReason, STORNO_REASON } from "../reasons";

/** Note of a settlement whose document has no Steuermitteilung page. */
export const TRADE_WITHOUT_NOTICE_NOTE = "Keine Steuermitteilung im Dokument: Steuern sind nicht enthalten. Bitte prüfen.";

/** Note of a dividend credit until its Steuermitteilung is merged (`linkDocuments`). */
export function creditWithoutNoticeNote(reference: string): string {
  return `Steuermitteilung (Referenz-Nr. ${reference}) nicht im Import: Steuern sind nicht enthalten. Bitte prüfen oder zusammen hochladen.`;
}

/** A standalone Steuermitteilung of a trade: its settlement carries the values. */
export const TRADE_NOTICE_WITHOUT_SETTLEMENT_REASON =
  "Steuermitteilung zu einem Wertpapiergeschäft ohne Abrechnung. Bitte mit der Abrechnung hochladen.";

/** A Steuermitteilung page of a settlement document that belongs to no (or more than one) settlement. */
export const UNMATCHED_TRADE_NOTICE_REASON = `Steuermitteilung passt zu keiner Abrechnung im Dokument. ${MANUAL}`;

/** The Steuermitteilung's ISIN or amount before tax differs from its settlement. */
export function tradeNoticeMismatchReason(where = ""): string {
  return `Steuermitteilung passt nicht zur Abrechnung${where}. ${MANUAL}`;
}

/** vor Steuern + abgeführte Steuern ≠ nach Steuern. */
export function noticeArithmeticReason(where = ""): string {
  return `Beträge der Steuermitteilung gehen nicht auf${where}. ${MANUAL}`;
}

/** `linkDocuments`: the Steuermitteilung of a reference contradicts its Ertragsgutschrift. */
export function linkMismatchReason(reference: string): string {
  return `Steuermitteilung passt nicht zur Ertragsgutschrift (Referenz-Nr. ${reference}). ${MANUAL}`;
}

/** `linkDocuments`: a dividend Steuermitteilung without its Ertragsgutschrift in the same upload. */
export const NOTICE_WITHOUT_CREDIT_REASON = "Steuermitteilung ohne Ertragsgutschrift. Bitte zusammen hochladen.";

/** `linkDocuments`: info of a Steuermitteilung merged into the named credit file(s). */
export function noticeMergedInfo(creditFileNames: readonly string[]): string {
  return `Steuern in ${creditFileNames.map((name) => `„${name}“`).join(", ")} übernommen. Keine Buchung erforderlich.`;
}
