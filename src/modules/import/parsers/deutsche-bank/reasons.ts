// German failure reasons shared by the Deutsche Bank / ROBIN parsers. Each ends with the manual-entry hint.

const MANUAL = "Buchung bitte manuell erfassen.";

/** The document is a cancellation (Storno), which is never proposed automatically. */
export const STORNO_REASON = `Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`;

/** A value is stated in a currency other than EUR. */
export function foreignCurrencyReason(kind: "Abrechnung" | "Gutschrift", currency: string, where = ""): string {
  return `${kind} in Fremdwährung (${currency}) wird nicht unterstützt${where}. ${MANUAL}`;
}

/** A required field could not be read; `where` names the Abrechnung in multi-execution documents. */
export function missingFieldReason(field: string, where = ""): string {
  return `${field} nicht lesbar${where}. ${MANUAL}`;
}

/** The read values do not fit together. */
export function implausibleReason(what: string, where = ""): string {
  return `${what}${where}. ${MANUAL}`;
}
