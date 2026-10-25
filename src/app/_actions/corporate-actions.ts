"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/modules/auth";
import { deleteSplit, type DeleteSplitResult, recordSplit, type SplitResult, updateSplit } from "@/modules/ledger";

type Unauthorized = { ok: false; reason: "unauthorized" };

/** Result of `saveSplitAction` (new or edited split); `null` before the first submit. */
export type SplitActionState = SplitResult | Unauthorized | null;

/** Result of `deleteSplitAction`; `null` before the first attempt. */
export type DeleteSplitActionState = DeleteSplitResult | Unauthorized | null;

// Non-string values (e.g. a File) become "", which the ledger rejects with a typed reason.
const formText = z.string().catch("");

const splitForm = z.object({ securityId: formText, splitId: formText, date: formText, ratio: formText });

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

/**
 * Records a split of `securityId` through the ledger, or edits split `splitId` when given (date and
 * ratio only). Revalidates on success only.
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
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Deletes split `id` through the ledger. Revalidates on success only. */
export async function deleteSplitAction(id: string): Promise<DeleteSplitActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await deleteSplit(typeof id === "string" ? id : "");
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
