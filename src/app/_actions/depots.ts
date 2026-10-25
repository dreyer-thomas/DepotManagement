"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/modules/auth";
import { createDepot, type DepotResult, renameDepot } from "@/modules/ledger";

/** Result of a Depot server action; `null` before the first submit. */
export type DepotActionState = DepotResult | { ok: false; reason: "unauthorized" } | null;

// Non-string values (e.g. a File) become "", which the ledger rejects with a typed reason.
const formText = z.string().catch("");

const createInput = z.object({ name: formText, broker: formText });
const renameInput = z.object({ id: formText, name: formText });

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

export async function createDepotAction(_previous: DepotActionState, formData: FormData): Promise<DepotActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const input = createInput.parse({ name: formData.get("name"), broker: formData.get("broker") });
  const result = await createDepot(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function renameDepotAction(_previous: DepotActionState, formData: FormData): Promise<DepotActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const input = renameInput.parse({ id: formData.get("id"), name: formData.get("name") });
  if (!input.id) return { ok: false, reason: "not-found" };
  const result = await renameDepot(input.id, { name: input.name });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
