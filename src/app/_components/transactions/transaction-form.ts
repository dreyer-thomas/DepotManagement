import type { TransactionType } from "@/modules/ledger";
import type { TransactionField } from "./labels";

/** Form sections in display order per type; a hidden section is neither rendered nor submitted. */
export type FormSection = "security" | "date" | "quantityPrice" | "feeTax" | "amount" | "tax";

export const FORM_SECTIONS: Record<TransactionType, FormSection[]> = {
  BUY: ["security", "date", "quantityPrice", "feeTax"],
  SELL: ["security", "date", "quantityPrice", "feeTax"],
  DIVIDEND: ["security", "date", "amount", "tax"],
  FEE: ["amount", "security", "date"],
  TAX: ["amount", "security", "date"],
  DEPOSIT: ["amount", "date"],
  WITHDRAWAL: ["amount", "date"],
};

const SECTION_FIELDS: Record<FormSection, TransactionField[]> = {
  security: ["security", "securityIdentifier", "securityName", "assetType"],
  date: ["date"],
  quantityPrice: ["quantity", "price"],
  feeTax: ["fee", "tax"],
  amount: ["amount"],
  tax: ["tax"],
};

const SECURITY_REQUIRED: ReadonlySet<TransactionType> = new Set(["BUY", "SELL", "DIVIDEND"]);

/** Fields the form shows for `type` (the type selector always). */
export function visibleFields(type: TransactionType): Set<TransactionField> {
  return new Set<TransactionField>(["type", ...FORM_SECTIONS[type].flatMap((section) => SECTION_FIELDS[section])]);
}

/** Whether `type` shows (and submits) a Security, and whether it is required. */
export function securityMode(type: TransactionType): "required" | "optional" | "none" {
  if (!FORM_SECTIONS[type].includes("security")) return "none";
  return SECURITY_REQUIRED.has(type) ? "required" : "optional";
}

export type ErrorPlacement = { kind: "none" } | { kind: "field"; field: TransactionField } | { kind: "alert" };

/**
 * Where the last submit's error shows: nothing once the type differs from the submitted one; its
 * mapped field when the current type shows it; otherwise an Alert.
 */
export function errorPlacement(
  type: TransactionType,
  submittedType: TransactionType,
  mappedField: TransactionField | undefined,
): ErrorPlacement {
  if (type !== submittedType) return { kind: "none" };
  if (mappedField && visibleFields(type).has(mappedField)) return { kind: "field", field: mappedField };
  return { kind: "alert" };
}
