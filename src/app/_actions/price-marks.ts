"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PRICE_MARK_FIELDS, priceMarksFormOf } from "@/app/_components/price-marks/form-fields";
import { businessDate } from "@/core/dates";
import { parsePriceMarksForm } from "@/core/price-marks";
import { getSession } from "@/modules/auth";
import { setPriceMarks, type SetPriceMarksResult } from "@/modules/marks";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

/** Result of "Kursmarken bearbeiten"; `null` before the first submit. */
export type SetPriceMarksActionState = SetPriceMarksResult | typeof UNAUTHORIZED | null;

const formText = z.string().catch("");

/** Every page that shows marks or their breaches: dashboard, securities, the detail page, watchlists. */
function revalidatePriceMarks(): void {
  revalidatePath("/");
  revalidatePath("/securities");
  revalidatePath("/securities/[id]", "page");
  revalidatePath("/watchlists");
}

/**
 * "Kursmarken bearbeiten": stop and target of one Security from the marks form (German decimals; "Kein
 * Stopp" / an empty target price clear the mark). Validated by `core/price-marks`, written through the
 * marks service; nothing is written when a field is refused.
 */
export async function setPriceMarksAction(_previous: SetPriceMarksActionState, formData: FormData): Promise<SetPriceMarksActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const today = businessDate(new Date());
  const parsed = parsePriceMarksForm(priceMarksFormOf(formData), today);
  if (!parsed.ok) return parsed;
  const result = await setPriceMarks(formText.parse(formData.get(PRICE_MARK_FIELDS.securityId)), parsed.patch, today);
  if (result.ok || result.reason === "not-found") revalidatePriceMarks();
  return result;
}
