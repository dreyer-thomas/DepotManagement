"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ALLOW_DUPLICATE_MARKER,
  NEW_SECURITY_MARKER,
  TRADE_FIELDS,
  type TradeFieldName,
} from "@/app/_components/transactions/form-fields";
import { parseDecimalInput } from "@/core/decimal-input";
import { getSession } from "@/modules/auth";
import {
  deleteTransaction,
  type DeleteTransactionResult,
  recordTransaction,
  type RecordTransactionInput,
  updateTransaction,
  type UpdateTransactionResult,
} from "@/modules/ledger";
import { newSecurityInput } from "./new-security-input";
import { schedulePriceBackfill } from "./price-refresh";

type Unauthorized = { ok: false; reason: "unauthorized" };

/** Result of `saveTransactionAction` (new or edited Transaction); `null` before the first submit. */
export type TransactionActionState = UpdateTransactionResult | Unauthorized | null;

/** Result of `deleteTransactionAction`; `null` before the first attempt. */
export type DeleteTransactionActionState = DeleteTransactionResult | Unauthorized | null;

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
  [TRADE_FIELDS.transactionId]: formText,
  [TRADE_FIELDS.allowDuplicate]: formText,
} satisfies Record<TradeFieldName, typeof formText>);

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

type DecimalField = "quantity" | "price" | "fee" | "tax" | "amount";

/** The form's figure fields each type shows; others are not read. */
function usedFields(type: string): DecimalField[] {
  if (type === "BUY" || type === "SELL") return ["quantity", "price", "fee", "tax"];
  if (type === "DIVIDEND") return ["amount", "tax"];
  if (type === "ADJUSTMENT") return ["quantity", "price"];
  return ["amount"];
}

/** The ledger reason for an unparseable field; the "Betrag" of a FEE/TAX is its fee/tax. */
function fieldReason(field: DecimalField, type: string): `${DecimalField}-invalid` {
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
    case "ADJUSTMENT":
      return { quantity: values.quantity, price: values.price };
    case "FEE":
      return { fee: values.amount };
    case "TAX":
      return { tax: values.amount };
    default:
      return { amount: values.amount };
  }
}

/**
 * Books the submitted Transaction through the ledger: a new one without `transactionId`, else an edit
 * of that Transaction. `allowDuplicate` = "1" confirms a possible duplicate. Revalidates and schedules a price backfill on success only.
 */
export async function saveTransactionAction(
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

  const input: RecordTransactionInput = {
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
    allowDuplicate: form.allowDuplicate === ALLOW_DUPLICATE_MARKER,
  };
  const result = form.transactionId
    ? await updateTransaction(form.transactionId, input)
    : await recordTransaction(input);
  if (result.ok) {
    revalidatePath("/", "layout");
    schedulePriceBackfill();
  }
  return result;
}

/** Deletes Transaction `id` through the ledger. Revalidates and schedules a price backfill on success only. */
export async function deleteTransactionAction(id: string): Promise<DeleteTransactionActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await deleteTransaction(typeof id === "string" ? id : "");
  if (result.ok) {
    revalidatePath("/", "layout");
    schedulePriceBackfill();
  }
  return result;
}
