"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth";
import { BROKERS, type Broker } from "@/modules/ledger";
import { setTaxAllowances, type SetTaxAllowancesResult, setTeilfreistellungOverride, type SetTeilfreistellungResult } from "@/modules/tax";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;
type Unauthorized = typeof UNAUTHORIZED;

/** Result of "Freistellungsaufträge speichern"; `null` before the first submit. */
export type SetTaxAllowancesActionState = SetTaxAllowancesResult | Unauthorized | null;

/** Result of "Teilfreistellung"; `null` before the first submit. */
export type SetTeilfreistellungActionState = SetTeilfreistellungResult | Unauthorized | null;

/**
 * Settings › Steuern: stores the Freistellungsaufträge of field `year` from the fields `amount-<BROKER>`
 * (an absent field leaves that broker unchanged; `""` or 0 removes it). Revalidates Settings and Analysen.
 */
export async function setTaxAllowancesAction(_previous: SetTaxAllowancesActionState, formData: FormData): Promise<SetTaxAllowancesActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const amounts: Partial<Record<Broker, unknown>> = {};
  for (const broker of BROKERS) {
    const value = formData.get(`amount-${broker}`);
    if (value !== null) amounts[broker] = value;
  }
  const result = await setTaxAllowances(formData.get("year"), amounts);
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/analyses");
  }
  return result;
}

/**
 * Securities page: sets the Teilfreistellung override of `securityId` to `rate` (`""` = automatic).
 * Revalidates the Securities page and Analysen.
 */
export async function setTeilfreistellungAction(
  _previous: SetTeilfreistellungActionState,
  formData: FormData,
): Promise<SetTeilfreistellungActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const securityId = formData.get("securityId");
  const result = await setTeilfreistellungOverride(typeof securityId === "string" ? securityId.trim() : "", formData.get("rate"));
  if (result.ok) {
    revalidatePath("/securities");
    revalidatePath("/analyses");
  }
  return result;
}
