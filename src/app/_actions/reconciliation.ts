"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { businessDate } from "@/core/dates";
import { parseDecimalInput } from "@/core/decimal-input";
import { getSession } from "@/modules/auth";
import {
  bookReconciliationCorrection,
  type BookReconciliationCorrectionResult,
  finishReconciliation,
  type FinishReconciliationResult,
  openReconciliation,
  type OpenReconciliationResult,
  saveReconciliationRow,
  type SaveReconciliationRowResult,
} from "@/modules/ledger";
import { schedulePriceBackfill } from "./price-refresh";

type Unauthorized = { ok: false; reason: "unauthorized" };

const UNAUTHORIZED: Unauthorized = { ok: false, reason: "unauthorized" };

/** Result of `openReconciliationAction`; `null` before the first submit. */
export type OpenReconciliationActionState = OpenReconciliationResult | Unauthorized | null;
export type SaveReconciliationRowActionResult = SaveReconciliationRowResult | Unauthorized;
export type BookReconciliationCorrectionActionResult = BookReconciliationCorrectionResult | Unauthorized;
export type FinishReconciliationActionResult = FinishReconciliationResult | Unauthorized;

// Non-string values (e.g. a File) become "", which the ledger rejects with a typed reason.
const formText = z.string().catch("");
const openForm = z.object({ depotId: formText, statementDate: formText });

/** `null` stays the Cash Account; anything but a non-empty string is the Cash Account too. */
function securityRef(securityId: unknown): string | null {
  return typeof securityId === "string" && securityId !== "" ? securityId : null;
}

/** Starts a reconciliation run ("Abgleich starten") for the submitted Stichtag; today is Europe/Berlin. */
export async function openReconciliationAction(
  _previous: OpenReconciliationActionState,
  formData: FormData,
): Promise<OpenReconciliationActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const form = openForm.parse({ depotId: formData.get("depotId"), statementDate: formData.get("statementDate") });
  const result = await openReconciliation(form.depotId, form.statementDate, businessDate(new Date()));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/**
 * Saves a row's statement value (German decimal text; empty clears it) and/or its "stimmt" check.
 * Unparseable text is `value-invalid`.
 */
export async function saveReconciliationRowAction(
  runId: string,
  securityId: string | null,
  input: { statementValue?: string; checked?: boolean },
): Promise<SaveReconciliationRowActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  let statementValue: string | undefined;
  if (typeof input.statementValue === "string") {
    const parsed = parseDecimalInput(input.statementValue);
    if (!parsed.ok) return { ok: false, reason: "value-invalid" };
    statementValue = parsed.value;
  }
  const result = await saveReconciliationRow(typeof runId === "string" ? runId : "", securityRef(securityId), {
    ...(statementValue === undefined ? {} : { statementValue }),
    ...(input.checked === undefined ? {} : { checked: input.checked }),
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Books a row's correction ("Korrektur buchen"); `unitCost` is German decimal text (empty = default). */
export async function bookReconciliationCorrectionAction(
  runId: string,
  securityId: string | null,
  unitCost?: string,
): Promise<BookReconciliationCorrectionActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  let cost: string | undefined;
  if (typeof unitCost === "string") {
    const parsed = parseDecimalInput(unitCost);
    if (!parsed.ok) return { ok: false, reason: "price-invalid" };
    cost = parsed.value === "" ? undefined : parsed.value;
  }
  const result = await bookReconciliationCorrection(typeof runId === "string" ? runId : "", securityRef(securityId), cost);
  if (result.ok) {
    revalidatePath("/", "layout");
    // A correction can make a Security held again.
    schedulePriceBackfill();
  }
  return result;
}

/** Finishes the run ("Abgleich abschließen"). */
export async function finishReconciliationAction(runId: string): Promise<FinishReconciliationActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await finishReconciliation(typeof runId === "string" ? runId : "", new Date().toISOString());
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
