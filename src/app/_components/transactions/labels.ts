import { formatQuantity } from "@/core/format";
import type { AssetType, TradeFailureReason, TransactionType } from "@/modules/ledger";

/** German labels of the Transaction types. */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  BUY: "Kauf",
  SELL: "Verkauf",
  DIVIDEND: "Dividende",
  FEE: "Gebühr",
  TAX: "Steuer",
  DEPOSIT: "Einzahlung",
  WITHDRAWAL: "Auszahlung",
};

export function transactionTypeLabel(type: TransactionType): string {
  return TRANSACTION_TYPE_LABELS[type];
}

/** German labels of the asset types offered for a new Security, in selection order. */
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  STOCK: "Aktie",
  ETF: "ETF",
  CERTIFICATE: "Zertifikat",
  CRYPTO: "Krypto",
  UNCLASSIFIED: "Nicht zugeordnet",
};

export const NEW_SECURITY_ASSET_TYPES: AssetType[] = ["STOCK", "ETF", "CERTIFICATE", "CRYPTO"];

export type TransactionErrorReason = TradeFailureReason | "unauthorized";

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
  | "tax";

const MESSAGES: Record<Exclude<TransactionErrorReason, "sell-exceeds-holding">, string> = {
  "depot-not-found": "Depot nicht gefunden.",
  "type-invalid": "Bitte Kauf oder Verkauf wählen.",
  "date-invalid": "Bitte ein gültiges Datum eingeben.",
  "quantity-invalid": "Bitte eine Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.",
  "price-invalid": "Bitte einen Kurs von mindestens 0 eingeben.",
  "fee-invalid": "Gebühren dürfen nicht negativ sein.",
  "tax-invalid": "Bitte einen gültigen Steuerbetrag eingeben.",
  "amount-invalid": "Der Betrag darf nicht negativ sein.",
  "security-required": "Bitte eine Security wählen.",
  "security-not-found": "Security nicht gefunden.",
  "isin-invalid": "Bitte eine gültige ISIN eingeben.",
  "crypto-symbol-invalid": "Bitte ein gültiges Krypto-Symbol eingeben (bis 10 Buchstaben oder Ziffern).",
  "security-name-invalid": "Bitte einen Namen mit höchstens 100 Zeichen eingeben.",
  "asset-type-invalid": "Bitte eine passende Art wählen: Krypto braucht ein Krypto-Symbol, Aktie, ETF und Zertifikat eine ISIN.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a trade write failure; `available` is the sellable quantity on an oversell. */
export function transactionErrorMessage(reason: TransactionErrorReason, available?: string): string {
  if (reason === "sell-exceeds-holding") return `Verkauf übersteigt Bestand (${formatQuantity(available ?? "0")} Stück).`;
  return MESSAGES[reason];
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
  "isin-invalid": "securityIdentifier",
  "crypto-symbol-invalid": "securityIdentifier",
  "security-name-invalid": "securityName",
  "asset-type-invalid": "assetType",
};

/** Which form field an error belongs to; others (Depot, session) show as an Alert. */
export function transactionErrorField(reason: TransactionErrorReason): TransactionField | undefined {
  return FIELDS[reason];
}
