"use server";

import { revalidatePath } from "next/cache";
import { DIMENSIONS } from "@/core/classification";
import { SPLIT_REGIONS, type SplitRegion } from "@/core/region-split";
import { getSession } from "@/modules/auth";
import {
  type ManualClassificationInput,
  setAnalystSymbol,
  type SetAnalystSymbolResult,
  setManualClassification,
  type SetManualClassificationResult,
  setManualRegionSplit,
  type SetManualRegionSplitResult,
} from "@/modules/classification";
import { scheduleClassificationRefresh } from "./classification-refresh";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;
type Unauthorized = typeof UNAUTHORIZED;

/** Result of "Klassifizierung bearbeiten"; `null` before the first submit. */
export type SetClassificationActionState = SetManualClassificationResult | Unauthorized | null;

/**
 * "Klassifizierung bearbeiten": stores the manual overrides of Security `securityId`. Each dimension field
 * holds the override or `""` (Automatisch); an absent field leaves its override unchanged. Non-string
 * values (e.g. a File) are rejected by the service as invalid. On success revalidates the Securities page and
 * schedules a refresh, so certificates inheriting this Security's effective values pick up the override.
 */
export async function setClassificationAction(
  _previous: SetClassificationActionState,
  formData: FormData,
): Promise<SetClassificationActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const securityId = formData.get("securityId");
  const input: ManualClassificationInput = {};
  for (const dimension of DIMENSIONS) {
    const value = formData.get(dimension);
    if (value !== null) input[dimension] = value;
  }
  const result = await setManualClassification(typeof securityId === "string" ? securityId.trim() : "", input);
  if (result.ok) {
    revalidatePath("/securities");
    scheduleClassificationRefresh();
  }
  return result;
}

/** Result of "Regionen"; `null` before the first submit. */
export type SetRegionSplitActionState = SetManualRegionSplitResult | Unauthorized | null;

/**
 * "Regionen" (story 8.4): stores the manual region split of fund `securityId` from the fields `split-<i>`
 * (percent of `SPLIT_REGIONS[i]`, German input; every field empty = Automatisch, i.e. the rule split).
 * Revalidates the Securities page and Analysen.
 */
export async function setRegionSplitAction(_previous: SetRegionSplitActionState, formData: FormData): Promise<SetRegionSplitActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const securityId = formData.get("securityId");
  const input: Partial<Record<SplitRegion, unknown>> = {};
  SPLIT_REGIONS.forEach((region, index) => {
    const value = formData.get(`split-${index}`);
    if (value !== null) input[region] = value;
  });
  const result = await setManualRegionSplit(typeof securityId === "string" ? securityId.trim() : "", input);
  if (result.ok) {
    revalidatePath("/securities");
    revalidatePath("/analyses");
  }
  return result;
}

/** Result of "Analysten-Symbol" (story 9.7). */
export type SetAnalystSymbolActionResult = SetAnalystSymbolResult | Unauthorized;

/**
 * "Analysten-Symbol" (story 9.7): sets the Yahoo symbol the analyst ratings of stock `securityId` come
 * from (`""` = automatic, resolved again by ISIN). Revalidates the Securities page and the Security's
 * detail page; the next refresh (or "Kennzahlen aktualisieren") refetches.
 */
export async function setAnalystSymbolAction(securityId: string, symbol: string): Promise<SetAnalystSymbolActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const id = typeof securityId === "string" ? securityId.trim() : "";
  const result = await setAnalystSymbol(id, symbol);
  if (result.ok) {
    revalidatePath("/securities");
    revalidatePath(`/securities/${id}`);
  }
  return result;
}
