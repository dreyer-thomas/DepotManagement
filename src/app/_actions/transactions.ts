"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NEW_SECURITY_MARKER, TRADE_FIELDS, type TradeFieldName } from "@/app/_components/transactions/form-fields";
import { parseDecimalInput } from "@/core/decimal-input";
import { getSession } from "@/modules/auth";
import { recordTrade, type RecordTradeInput, type RecordTradeResult } from "@/modules/ledger";

/** Result of the trade server action; `null` before the first submit. */
export type TradeActionState = RecordTradeResult | { ok: false; reason: "unauthorized" } | null;

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
function newSecurityInput(identifier: string, name: string, assetType: string): RecordTradeInput["security"] {
  const trimmed = identifier.trim();
  const isIsin = ISIN_SHAPE.test(trimmed) || (assetType !== "CRYPTO" && assetType !== "");
  return { new: isIsin ? { isin: trimmed, name, assetType } : { cryptoSymbol: trimmed, name, assetType } };
}

type DecimalField = "quantity" | "price" | "fee" | "tax";
const FIELD_REASONS = {
  quantity: "quantity-invalid",
  price: "price-invalid",
  fee: "fee-invalid",
  tax: "tax-invalid",
} as const;

export async function recordTradeAction(_previous: TradeActionState, formData: FormData): Promise<TradeActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const form = tradeForm.parse(Object.fromEntries(Object.keys(tradeForm.shape).map((key) => [key, formData.get(key)])));

  const decimals = {} as Record<DecimalField, string | undefined>;
  for (const field of ["quantity", "price", "fee", "tax"] as const) {
    const parsed = parseDecimalInput(form[field]);
    if (!parsed.ok) return { ok: false, reason: FIELD_REASONS[field] };
    decimals[field] = parsed.value === "" ? undefined : parsed.value;
  }

  const result = await recordTrade({
    depotId: form.depotId,
    type: form.type,
    date: form.date,
    quantity: decimals.quantity,
    price: decimals.price,
    fee: decimals.fee,
    tax: decimals.tax,
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
