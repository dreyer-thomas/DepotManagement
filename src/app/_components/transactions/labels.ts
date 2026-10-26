import { formatDate, formatQuantity } from "@/core/format";
import type { AssetType, TransactionFailureReason, TransactionType } from "@/modules/ledger";

/** German labels of the Transaction types. */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  BUY: "Kauf",
  SELL: "Verkauf",
  DIVIDEND: "Dividende",
  FEE: "Gebühr",
  TAX: "Steuer",
  DEPOSIT: "Einzahlung",
  WITHDRAWAL: "Auszahlung",
  ADJUSTMENT: "Bestandskorrektur",
};

/** All Transaction types in selection order. */
export const TRANSACTION_TYPE_ORDER: TransactionType[] = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "FEE",
  "TAX",
  "DEPOSIT",
  "WITHDRAWAL",
  "ADJUSTMENT",
];

export function transactionTypeLabel(type: TransactionType): string {
  return TRANSACTION_TYPE_LABELS[type];
}

/** German labels of the asset types offered for a new Security, in selection order. */
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  STOCK: "Aktie",
  ETF: "ETF",
  FUND: "Fonds",
  CERTIFICATE: "Zertifikat",
  CRYPTO: "Krypto",
  UNCLASSIFIED: "Nicht zugeordnet",
};

export const NEW_SECURITY_ASSET_TYPES: AssetType[] = ["STOCK", "ETF", "FUND", "CERTIFICATE", "CRYPTO"];

export type TransactionErrorReason = TransactionFailureReason | "unauthorized";

export type TransactionField =
  | "type"
  | "security"
  | "securityIdentifier"
  | "securityName"
  | "assetType"
  | "date"
  | "quantity"
  | "price"
  | "fee"
  | "tax"
  | "amount";

type MessageReason = Exclude<TransactionErrorReason, "sell-exceeds-holding" | "later-sell-exceeds-holding">;

const MESSAGES: Record<MessageReason, string> = {
  "depot-not-found": "Depot nicht gefunden.",
  "depot-archived": "Depot ist archiviert. Bitte zuerst reaktivieren.",
  "type-invalid": "Bitte eine Buchungsart wählen.",
  "date-invalid": "Bitte ein gültiges Datum eingeben.",
  "quantity-invalid": "Bitte eine Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.",
  "price-invalid": "Bitte einen Kurs von mindestens 0 eingeben.",
  "fee-invalid": "Gebühren dürfen nicht negativ sein.",
  "tax-invalid": "Bitte einen gültigen Steuerbetrag eingeben.",
  "amount-invalid": "Bitte einen Betrag größer 0 eingeben.",
  "note-invalid": "Bitte eine Notiz mit höchstens 200 Zeichen eingeben.",
  "security-required": "Bitte eine Security wählen.",
  "security-not-found": "Security nicht gefunden.",
  "security-not-allowed": "Ein- und Auszahlungen haben keine Security.",
  "isin-invalid": "Bitte eine gültige ISIN eingeben.",
  "crypto-symbol-invalid": "Bitte ein gültiges Krypto-Symbol eingeben (bis 10 Buchstaben oder Ziffern).",
  "security-name-invalid": "Bitte einen Namen mit höchstens 100 Zeichen eingeben.",
  "asset-type-invalid": "Bitte eine passende Art wählen: Krypto braucht ein Krypto-Symbol, Aktie, ETF, Fonds und Zertifikat eine ISIN.",
  "possible-duplicate": "Mögliche Doppelbuchung.",
  "transaction-not-found": "Buchung nicht gefunden.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** Messages that depend on the booked type, e.g. a FEE's "Betrag" is its fee. */
const TYPE_MESSAGES: Partial<Record<TransactionType, Partial<Record<MessageReason, string>>>> = {
  BUY: { "amount-invalid": "Der Betrag darf nicht negativ sein." },
  SELL: { "amount-invalid": "Der Betrag darf nicht negativ sein." },
  FEE: { "fee-invalid": "Bitte einen Betrag größer 0 eingeben." },
  TAX: { "tax-invalid": "Bitte einen Betrag ungleich 0 eingeben." },
  ADJUSTMENT: {
    "quantity-invalid": "Bitte eine Stückzahl ungleich 0 mit höchstens 8 Nachkommastellen eingeben (negativ = Abgang).",
    "price-invalid": "Bitte einen Einstandskurs von mindestens 0 eingeben.",
  },
};

/**
 * German message for a write failure; `detail` is the sellable quantity on `sell-exceeds-holding` and
 * the SELL's date on `later-sell-exceeds-holding`, `type` the submitted Transaction type (some messages
 * depend on it).
 */
export function transactionErrorMessage(reason: TransactionErrorReason, detail?: string, type?: TransactionType): string {
  if (reason === "sell-exceeds-holding") {
    if (type === "ADJUSTMENT") {
      return `Korrektur übersteigt den verfügbaren Bestand (höchstens ${formatQuantity(detail ?? "0")} Stück, spätere Verkäufe eingerechnet).`;
    }
    return `Verkauf übersteigt Bestand (${formatQuantity(detail ?? "0")} Stück).`;
  }
  if (reason === "later-sell-exceeds-holding") {
    return `Nicht möglich: Der Verkauf am ${detail ? formatDate(detail) : "?"} würde den Bestand übersteigen.`;
  }
  return (type && TYPE_MESSAGES[type]?.[reason]) ?? MESSAGES[reason];
}

const FIELDS: Partial<Record<TransactionErrorReason, TransactionField>> = {
  "type-invalid": "type",
  "date-invalid": "date",
  "quantity-invalid": "quantity",
  "sell-exceeds-holding": "quantity",
  "price-invalid": "price",
  "amount-invalid": "price",
  "fee-invalid": "fee",
  "tax-invalid": "tax",
  "security-required": "security",
  "security-not-found": "security",
  "security-not-allowed": "security",
  "isin-invalid": "securityIdentifier",
  "crypto-symbol-invalid": "securityIdentifier",
  "security-name-invalid": "securityName",
  "asset-type-invalid": "assetType",
};

/** Field overrides per type: non-trades enter their value in the single "amount" field. */
const TYPE_FIELDS: Partial<Record<TransactionType, Partial<Record<TransactionErrorReason, TransactionField>>>> = {
  DIVIDEND: { "amount-invalid": "amount" },
  FEE: { "fee-invalid": "amount", "amount-invalid": "amount" },
  TAX: { "tax-invalid": "amount", "amount-invalid": "amount" },
  DEPOSIT: { "amount-invalid": "amount" },
  WITHDRAWAL: { "amount-invalid": "amount" },
};

/** Which form field an error belongs to for `type`; others (Depot, session) show as an Alert. */
export function transactionErrorField(reason: TransactionErrorReason, type?: TransactionType): TransactionField | undefined {
  return (type && TYPE_FIELDS[type]?.[reason]) ?? FIELDS[reason];
}

/** The detail a failure's message needs: the available quantity or the later SELL's date. */
export function failureDetail(failure: object): string | undefined {
  if ("available" in failure && typeof failure.available === "string") return failure.available;
  if ("date" in failure && typeof failure.date === "string") return failure.date;
  return undefined;
}
