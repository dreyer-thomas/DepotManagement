"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseDecimalInput } from "@/core/decimal-input";
import { getSession } from "@/modules/auth";
import {
  deleteIsinChange,
  type DeleteIsinChangeResult,
  deleteSplit,
  type DeleteSplitResult,
  type IsinChangeResult,
  recordIsinChange,
  recordSplit,
  type SplitResult,
  updateIsinChange,
  updateSplit,
} from "@/modules/ledger";
import { ISIN_CHANGE_FIELDS, NEW_SECURITY_MARKER } from "@/app/_components/corporate-actions/form-fields";
import { newSecurityInput } from "./new-security-input";
import { schedulePriceBackfill, schedulePriceRefetch } from "./price-refresh";

type Unauthorized = { ok: false; reason: "unauthorized" };

/** Result of `saveSplitAction` (new or edited split); `null` before the first submit. */
export type SplitActionState = SplitResult | Unauthorized | null;

/** Result of `deleteSplitAction`; `null` before the first attempt. */
export type DeleteSplitActionState = DeleteSplitResult | Unauthorized | null;

/** Result of `saveIsinChangeAction` (new or edited ISIN change); `null` before the first submit. */
export type IsinChangeActionState = IsinChangeResult | Unauthorized | null;

/** Result of `deleteIsinChangeAction`; `null` before the first attempt. */
export type DeleteIsinChangeActionState = DeleteIsinChangeResult | Unauthorized | null;

// Non-string values (e.g. a File) become "", which the ledger rejects with a typed reason.
const formText = z.string().catch("");

const splitForm = z.object({ securityId: formText, splitId: formText, date: formText, ratio: formText });

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

/**
 * Records a split of `securityId` through the ledger, or edits split `splitId` when given (date and
 * ratio only). Revalidates and schedules a price history refetch of the Security on success only.
 */
export async function saveSplitAction(_previous: SplitActionState, formData: FormData): Promise<SplitActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const form = splitForm.parse({
    securityId: formData.get("securityId"),
    splitId: formData.get("splitId"),
    date: formData.get("date"),
    ratio: formData.get("ratio"),
  });
  const result = form.splitId
    ? await updateSplit(form.splitId, { date: form.date, ratio: form.ratio })
    : await recordSplit({ securityId: form.securityId, date: form.date, ratio: form.ratio });
  if (result.ok) {
    revalidatePath("/", "layout");
    schedulePriceRefetch(result.split.security.id);
  }
  return result;
}

/** Deletes split `id` through the ledger. Revalidates and schedules a price history refetch on success only. */
export async function deleteSplitAction(id: string): Promise<DeleteSplitActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await deleteSplit(typeof id === "string" ? id : "");
  if (result.ok) {
    revalidatePath("/", "layout");
    schedulePriceRefetch(result.split.security.id);
  }
  return result;
}

const isinChangeForm = z.object({
  [ISIN_CHANGE_FIELDS.oldSecurityId]: formText,
  [ISIN_CHANGE_FIELDS.isinChangeId]: formText,
  [ISIN_CHANGE_FIELDS.newSecurityId]: formText,
  [ISIN_CHANGE_FIELDS.newSecurity]: formText,
  [ISIN_CHANGE_FIELDS.securityIdentifier]: formText,
  [ISIN_CHANGE_FIELDS.securityName]: formText,
  [ISIN_CHANGE_FIELDS.assetType]: formText,
  [ISIN_CHANGE_FIELDS.date]: formText,
  [ISIN_CHANGE_FIELDS.oldQuantity]: formText,
  [ISIN_CHANGE_FIELDS.newQuantity]: formText,
});

/**
 * Records an ISIN change of `oldSecurityId` through the ledger (new Security selected by id, or
 * created from the "Neue Security anlegen" fields), or edits ISIN change `isinChangeId` when given
 * (date and quantities only). Quantities are German decimals. Revalidates and schedules a price backfill
 * on success only.
 */
export async function saveIsinChangeAction(
  _previous: IsinChangeActionState,
  formData: FormData,
): Promise<IsinChangeActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const form = isinChangeForm.parse(
    Object.fromEntries(Object.keys(isinChangeForm.shape).map((key) => [key, formData.get(key)])),
  );
  const oldQuantity = parseDecimalInput(form.oldQuantity);
  if (!oldQuantity.ok) return { ok: false, reason: "old-quantity-invalid" };
  const newQuantity = parseDecimalInput(form.newQuantity);
  if (!newQuantity.ok) return { ok: false, reason: "new-quantity-invalid" };
  const values = { date: form.date, oldQuantity: oldQuantity.value, newQuantity: newQuantity.value };
  const result = form.isinChangeId
    ? await updateIsinChange(form.isinChangeId, values)
    : await recordIsinChange({
        ...values,
        oldSecurityId: form.oldSecurityId,
        newSecurity:
          form.newSecurity === NEW_SECURITY_MARKER
            ? newSecurityInput(form.securityIdentifier, form.securityName, form.assetType)
            : { id: form.newSecurityId },
      });
  if (result.ok) {
    revalidatePath("/", "layout");
    schedulePriceBackfill();
  }
  return result;
}

/** Deletes ISIN change `id` through the ledger. Revalidates and schedules a price backfill on success only. */
export async function deleteIsinChangeAction(id: string): Promise<DeleteIsinChangeActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await deleteIsinChange(typeof id === "string" ? id : "");
  if (result.ok) {
    revalidatePath("/", "layout");
    schedulePriceBackfill();
  }
  return result;
}
