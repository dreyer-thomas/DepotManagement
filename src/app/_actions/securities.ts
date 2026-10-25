"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/modules/auth";
import { changeSecurityType, type ChangeSecurityTypeResult } from "@/modules/ledger";
import {
  resolveMappingFor,
  type ResolveMappingForResult,
  resolveMissingMappings,
  type ResolveMissingResult,
  setMapping,
  type SetMappingResult,
} from "@/modules/prices";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;
type Unauthorized = typeof UNAUTHORIZED;

// Non-string values (e.g. a File) become "", which the services reject with a typed reason.
const formText = z.string().catch("");

/** Result of the auto-resolver run. */
export type ResolveMissingActionResult = ({ ok: true } & ResolveMissingResult) | Unauthorized;

/** Result of "Automatisch suchen" for one Security; `null` before the first submit. */
export type ResolveMappingActionState = ResolveMappingForResult | Unauthorized | null;

/** Result of "Kursquelle bearbeiten"; `null` before the first submit. */
export type SetMappingActionState = SetMappingResult | Unauthorized | null;

/** Result of "Typ ändern"; `null` before the first submit. */
export type ChangeSecurityTypeActionState = ChangeSecurityTypeResult | Unauthorized | null;

/**
 * Resolves the provider mapping of every Security without one (called once by the Securities page
 * after it has rendered, never during render).
 */
export async function resolveMissingMappingsAction(): Promise<ResolveMissingActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await resolveMissingMappings();
  if (result.mapped > 0 || result.notFound > 0) revalidatePath("/securities");
  return { ok: true, ...result };
}

export async function resolveMappingAction(
  _previous: ResolveMappingActionState,
  formData: FormData,
): Promise<ResolveMappingActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const securityId = formText.parse(formData.get("securityId"));
  const result = await resolveMappingFor(securityId);
  // `already-mapped`: a mapping was saved meanwhile; refresh so the stale marker disappears.
  if (result.ok || result.reason === "already-mapped") revalidatePath("/securities");
  return result;
}

const mappingInput = z.object({ securityId: formText, provider: formText, symbol: formText });

export async function setMappingAction(_previous: SetMappingActionState, formData: FormData): Promise<SetMappingActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const { securityId, provider, symbol } = mappingInput.parse({
    securityId: formData.get("securityId"),
    provider: formData.get("provider"),
    symbol: formData.get("symbol"),
  });
  const result = await setMapping(securityId, { provider, symbol });
  if (result.ok) revalidatePath("/securities");
  return result;
}

const typeInput = z.object({ securityId: formText, assetType: formText });

export async function changeSecurityTypeAction(
  _previous: ChangeSecurityTypeActionState,
  formData: FormData,
): Promise<ChangeSecurityTypeActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const { securityId, assetType } = typeInput.parse({
    securityId: formData.get("securityId"),
    assetType: formData.get("assetType"),
  });
  const result = await changeSecurityType(securityId, assetType);
  // The type is a ledger fact shown on other pages too (e.g. transaction dialogs), like other ledger writes.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
