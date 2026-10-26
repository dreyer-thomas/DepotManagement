import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { PossibleDuplicateFailure, SecuritySummary, TransactionRecord, TransactionType } from "@/modules/ledger";
import { NEW_SECURITY_MARKER, TRADE_FIELDS } from "./form-fields";
import { type TransactionField, transactionTypeLabel } from "./labels";

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

/** The event value shown as "Betrag": the gross amount, or the fee/tax of a standalone FEE/TAX. */
export function eventValue(transaction: Pick<TransactionRecord, "type" | "amount" | "fee" | "tax">): string {
  if (transaction.type === "FEE") return transaction.fee;
  if (transaction.type === "TAX") return transaction.tax;
  return transaction.amount;
}

/** The form's controlled values; figures as typed (decimal comma). */
export type FormValues = {
  type: TransactionType;
  security: SecuritySummary | null;
  date: string;
  quantity: string;
  price: string;
  fee: string;
  tax: string;
  amount: string;
};

/** A canonical decimal string as the form shows it: `"1234.5"` → `"1234,5"` (no grouping). */
function inputDecimal(value: string | null): string {
  return value === null ? "" : value.replace(".", ",");
}

/** Empty values of a new Transaction dated `today`, optionally with `security` preselected. */
export function emptyValues(today: string, security: SecuritySummary | null = null): FormValues {
  return { type: "BUY", security, date: today, quantity: "", price: "", fee: "", tax: "", amount: "" };
}

/**
 * Edit-mode values from a booked Transaction: every field the type shows, decimals with a comma; the
 * "Betrag" of a FEE/TAX is its fee/tax.
 */
export function initialValues(transaction: TransactionRecord): FormValues {
  const values: FormValues = {
    ...emptyValues(transaction.date),
    type: transaction.type,
    security: transaction.security,
  };
  switch (transaction.type) {
    case "BUY":
    case "SELL":
      return {
        ...values,
        quantity: inputDecimal(transaction.quantity),
        price: inputDecimal(transaction.price),
        fee: inputDecimal(transaction.fee),
        tax: inputDecimal(transaction.tax),
      };
    case "DIVIDEND":
      return { ...values, amount: inputDecimal(transaction.amount), tax: inputDecimal(transaction.tax) };
    default:
      return { ...values, amount: inputDecimal(eventValue(transaction)) };
  }
}

/** `Kauf „Apple Inc.“`, or just `Einzahlung` without a Security. */
function typeAndSecurity(transaction: TransactionRecord): string {
  const type = transactionTypeLabel(transaction.type);
  return transaction.security ? `${type} „${transaction.security.name}“` : type;
}

/** Delete confirmation naming type, Security (if any), date and Depot. */
export function deleteConfirmText(transaction: TransactionRecord, depotName: string): string {
  return `${typeAndSecurity(transaction)} vom ${formatDate(transaction.date)} aus Depot „${depotName}“ löschen?`;
}

/** One existing Transaction: type, Security, date, quantity (trades) and value. */
function describeTransaction(transaction: TransactionRecord): string {
  const quantity = transaction.quantity ? `, ${formatQuantity(transaction.quantity)} Stück` : "";
  return `${typeAndSecurity(transaction)} vom ${formatDate(transaction.date)}${quantity}, ${formatMoney(eventValue(transaction))}`;
}

/** Inline warning for a possible duplicate, describing the existing Transaction(s). */
export function duplicateWarning(failure: Pick<PossibleDuplicateFailure, "status" | "matches">): string {
  const described = failure.matches.map(describeTransaction).join("; ");
  if (failure.status === "ambiguous") {
    return `Mögliche Doppelbuchung: ${failure.matches.length} gleiche Buchungen gibt es bereits (${described}).`;
  }
  return `Mögliche Doppelbuchung: Diese Buchung gibt es bereits (${described}).`;
}

/** What a submit sends: the type, the shown fields as typed, and the Security as `securityKey` gives it. */
export type SubmittedValues = {
  type: TransactionType;
  date: string;
  quantity: string;
  price: string;
  fee: string;
  tax: string;
  amount: string;
  security: string;
};

const KEY_FIELDS = ["date", "quantity", "price", "fee", "tax", "amount"] as const;

/** `id:<id>` for an existing Security, `new:<identifier>|<name>|<assetType>` for a new one, else `""`. */
export function securityKey(
  security: { id: string } | { identifier: string; name: string; assetType: string } | null,
): string {
  if (!security) return "";
  if ("id" in security) return `id:${security.id}`;
  return `new:${security.identifier}|${security.name}|${security.assetType}`;
}

/** Identity of the values a submit books; fields the type does not show do not count. */
export function valuesKey(values: SubmittedValues): string {
  const visible = visibleFields(values.type);
  return JSON.stringify([
    values.type,
    ...KEY_FIELDS.map((field) => (visible.has(field) ? values[field] : "")),
    visible.has("security") ? values.security : "",
  ]);
}

/** `valuesKey` of a submitted form. */
export function formDataKey(formData: FormData): string {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const securityId = text(TRADE_FIELDS.securityId);
  const security =
    text(TRADE_FIELDS.newSecurity) === NEW_SECURITY_MARKER
      ? securityKey({
          identifier: text(TRADE_FIELDS.securityIdentifier),
          name: text(TRADE_FIELDS.securityName),
          assetType: text(TRADE_FIELDS.assetType),
        })
      : securityKey(securityId ? { id: securityId } : null);
  return valuesKey({
    type: text(TRADE_FIELDS.type) as TransactionType,
    date: text(TRADE_FIELDS.date),
    quantity: text(TRADE_FIELDS.quantity),
    price: text(TRADE_FIELDS.price),
    fee: text(TRADE_FIELDS.fee),
    tax: text(TRADE_FIELDS.tax),
    amount: text(TRADE_FIELDS.amount),
    security,
  });
}

export type SubmitDecision = {
  /** The duplicate warning shows and the next submit confirms it. */
  duplicateActive: boolean;
  /** Submit `allowDuplicate` = "1". */
  allowDuplicate: boolean;
  /** Submit `transactionId` (edit mode). */
  sendTransactionId: boolean;
  label: "Buchen" | "Speichern" | "Trotzdem buchen";
};

/**
 * How the form submits: a duplicate warning (`warnedKey`, the key of the values that got it) stays
 * active only while the current values' key equals it; any change runs the check again.
 */
export function submitDecision({
  editing,
  warnedKey,
  currentKey,
}: {
  editing: boolean;
  warnedKey: string | null;
  currentKey: string;
}): SubmitDecision {
  const duplicateActive = warnedKey !== null && warnedKey === currentKey;
  return {
    duplicateActive,
    allowDuplicate: duplicateActive,
    sendTransactionId: editing,
    label: duplicateActive ? "Trotzdem buchen" : editing ? "Speichern" : "Buchen",
  };
}
