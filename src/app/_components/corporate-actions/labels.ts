import { formatDate, formatQuantity } from "@/core/format";
import type { IsinChangeFailureReason, IsinChangeRecord, SplitFailureReason } from "@/modules/ledger";

export type SplitErrorReason = SplitFailureReason | "unauthorized";

const MESSAGES: Record<Exclude<SplitErrorReason, "later-sell-exceeds-holding">, string> = {
  "security-not-found": "Security nicht gefunden.",
  "date-invalid": "Bitte ein gültiges Datum eingeben.",
  "ratio-invalid": "Bitte ein Verhältnis wie 1:4 eingeben (ganze Zahlen größer 0, verschieden).",
  "split-exists": "Für dieses Datum ist bereits ein Split erfasst.",
  "split-not-found": "Split nicht gefunden.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a split write failure; `date` is the SELL's date on `later-sell-exceeds-holding`. */
export function splitErrorMessage(reason: SplitErrorReason, date?: string): string {
  if (reason === "later-sell-exceeds-holding") {
    return `Nicht möglich: Der Verkauf am ${date ? formatDate(date) : "?"} würde den Bestand übersteigen.`;
  }
  return MESSAGES[reason];
}

/** Which form field an error belongs to; others show as an Alert. */
export function splitErrorField(reason: SplitErrorReason): "ratio" | "date" | undefined {
  if (reason === "ratio-invalid") return "ratio";
  if (reason === "date-invalid" || reason === "split-exists") return "date";
  return undefined;
}

/** A split ratio for display, e.g. `1:4`. */
export function formatSplitRatio(split: { ratioOld: string; ratioNew: string }): string {
  return `${split.ratioOld}:${split.ratioNew}`;
}

export type IsinChangeErrorReason = IsinChangeFailureReason | "unauthorized";

export type IsinChangeField =
  | "newSecurity"
  | "securityIdentifier"
  | "securityName"
  | "assetType"
  | "date"
  | "oldQuantity"
  | "newQuantity";

const ISIN_CHANGE_MESSAGES: Record<Exclude<IsinChangeErrorReason, "later-sell-exceeds-holding">, string> = {
  "security-not-found": "Bitte eine Security auswählen oder neu anlegen.",
  "same-security": "Die neue Security muss sich von der alten unterscheiden.",
  "date-invalid": "Bitte ein gültiges Datum eingeben.",
  "old-quantity-invalid": "Bitte eine alte Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.",
  "new-quantity-invalid": "Bitte eine neue Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.",
  "isin-change-exists": "Für dieses Datum ist bereits ein ISIN-Wechsel dieser Security erfasst.",
  "isin-change-not-found": "ISIN-Wechsel nicht gefunden.",
  "isin-invalid": "Bitte eine gültige ISIN eingeben.",
  "crypto-symbol-invalid": "Bitte ein gültiges Krypto-Symbol eingeben (bis 10 Buchstaben oder Ziffern).",
  "security-name-invalid": "Bitte einen Namen mit höchstens 100 Zeichen eingeben.",
  "asset-type-invalid": "Bitte eine passende Art wählen: Krypto braucht ein Krypto-Symbol, Aktie, ETF und Zertifikat eine ISIN.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for an ISIN-change write failure; `date` is the SELL's date on `later-sell-exceeds-holding`. */
export function isinChangeErrorMessage(reason: IsinChangeErrorReason, date?: string): string {
  if (reason === "later-sell-exceeds-holding") {
    return `Nicht möglich: Der Verkauf am ${date ? formatDate(date) : "?"} würde den Bestand übersteigen.`;
  }
  return ISIN_CHANGE_MESSAGES[reason];
}

const ISIN_CHANGE_FIELD_OF: Partial<Record<IsinChangeErrorReason, IsinChangeField>> = {
  "security-not-found": "newSecurity",
  "same-security": "newSecurity",
  "date-invalid": "date",
  "isin-change-exists": "date",
  "old-quantity-invalid": "oldQuantity",
  "new-quantity-invalid": "newQuantity",
  "isin-invalid": "securityIdentifier",
  "crypto-symbol-invalid": "securityIdentifier",
  "security-name-invalid": "securityName",
  "asset-type-invalid": "assetType",
};

/** Which form field an error belongs to; others show as an Alert. */
export function isinChangeErrorField(reason: IsinChangeErrorReason): IsinChangeField | undefined {
  return ISIN_CHANGE_FIELD_OF[reason];
}

/** An ISIN change's ratio for display, e.g. `10 : 5` (de-DE quantities). */
export function formatIsinChangeRatio(change: { oldQuantity: string; newQuantity: string }): string {
  return `${formatQuantity(change.oldQuantity)} : ${formatQuantity(change.newQuantity)}`;
}

/** The recorded ISIN changes in which `securityId` is the old or the new Security. */
export function isinChangesOf(isinChanges: readonly IsinChangeRecord[], securityId: string): IsinChangeRecord[] {
  return isinChanges.filter((change) => change.oldSecurity.id === securityId || change.newSecurity.id === securityId);
}
