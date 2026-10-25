"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NEW_SECURITY_MARKER, TRADE_FIELDS, type TradeFieldName } from "@/app/_components/transactions/form-fields";
import { parseDecimalInput } from "@/core/decimal-input";
import { getSession } from "@/modules/auth";
import {
  recordTransaction,
  type RecordTransactionInput,
  type RecordTransactionResult,
  type TransactionFailureReason,
} from "@/modules/ledger";

/** Result of the "Neue Buchung" server action; `null` before the first submit. */
export type TransactionActionState = RecordTransactionResult | { ok: false; reason: "unauthorized" } | null;

// Non-string values (e.g. a File) become "", which the ledger rejects with a typed reason.
const formText = z.string().catch("");

const tradeForm = z.object({
  [TRADE_FIELDS.depotId]: formText,
  [TRADE_FIELDS.type]: formText,
  [TRADE_FIELDS.date]: formText,
  [TRADE_FIELDS.quantity]: formText,
  [TRADE_FIELDS.price]: formText,
  [TRADE_FIELDS.fee]: formText,
  [TRADE_FIELDS.tax]: formText,
  [TRADE_FIELDS.amount]: formText,
  [TRADE_FIELDS.securityId]: formText,
  [TRADE_FIELDS.newSecurity]: formText,
  [TRADE_FIELDS.securityIdentifier]: formText,
  [TRADE_FIELDS.securityName]: formText,
  [TRADE_FIELDS.assetType]: formText,
} satisfies Record<TradeFieldName, typeof formText>);

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i;

/**
 * The form has one "ISIN oder Krypto-Symbol" field: an ISIN-shaped value, or any value for a
 * non-crypto asset type, is an ISIN; otherwise it is a crypto symbol. The ledger validates both.
 */
function newSecurityInput(identifier: string, name: string, assetType: string): RecordTransactionInput["security"] {
  const trimmed = identifier.trim();
  const isIsin = ISIN_SHAPE.test(trimmed) || (assetType !== "CRYPTO" && assetType !== "");
  return { new: isIsin ? { isin: trimmed, name, assetType } : { cryptoSymbol: trimmed, name, assetType } };
}

type DecimalField = "quantity" | "price" | "fee" | "tax" | "amount";

/** The form's figure fields each type shows; others are not read. */
function usedFields(type: string): DecimalField[] {
  if (type === "BUY" || type === "SELL") return ["quantity", "price", "fee", "tax"];
  if (type === "DIVIDEND") return ["amount", "tax"];
  return ["amount"];
}

/** The ledger reason for an unparseable field; the "Betrag" of a FEE/TAX is its fee/tax. */
function fieldReason(field: DecimalField, type: string): Exclude<TransactionFailureReason, "sell-exceeds-holding"> {
  if (field === "amount") return type === "FEE" ? "fee-invalid" : type === "TAX" ? "tax-invalid" : "amount-invalid";
  return `${field}-invalid`;
}

/** The submitted figures mapped to the ledger's AD-14 fields for `type`. */
function figures(type: string, values: Partial<Record<DecimalField, string>>): Partial<RecordTransactionInput> {
  switch (type) {
    case "BUY":
    case "SELL":
      return { quantity: values.quantity, price: values.price, fee: values.fee, tax: values.tax };
    case "DIVIDEND":
      return { amount: values.amount, tax: values.tax };
    case "FEE":
      return { fee: values.amount };
    case "TAX":
      return { tax: values.amount };
    default:
      return { amount: values.amount };
  }
}

export async function recordTransactionAction(
  _previous: TransactionActionState,
  formData: FormData,
): Promise<TransactionActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const form = tradeForm.parse(Object.fromEntries(Object.keys(tradeForm.shape).map((key) => [key, formData.get(key)])));

  const values: Partial<Record<DecimalField, string>> = {};
  for (const field of usedFields(form.type)) {
    const parsed = parseDecimalInput(form[field]);
    if (!parsed.ok) return { ok: false, reason: fieldReason(field, form.type) };
    if (parsed.value !== "") values[field] = parsed.value;
  }

  const result = await recordTransaction({
    depotId: form.depotId,
    type: form.type,
    date: form.date,
    ...figures(form.type, values),
    security:
      form.newSecurity === NEW_SECURITY_MARKER
        ? newSecurityInput(form.securityIdentifier, form.securityName, form.assetType)
        : form.securityId
          ? { id: form.securityId }
          : undefined,
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
