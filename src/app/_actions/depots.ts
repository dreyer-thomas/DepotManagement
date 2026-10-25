"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/modules/auth";
import {
  archiveDepot,
  type ArchiveDepotResult,
  createDepot,
  type DepotResult,
  renameDepot,
  unarchiveDepot,
  type UnarchiveDepotResult,
} from "@/modules/ledger";

/** Result of a Depot server action; `null` before the first submit. */
export type DepotActionState = DepotResult | { ok: false; reason: "unauthorized" } | null;

// Non-string values (e.g. a File) become "", which the ledger rejects with a typed reason.
const formText = z.string().catch("");

const createInput = z.object({ name: formText, broker: formText });
const renameInput = z.object({ id: formText, name: formText });

/** Result of the archive/unarchive server actions; `null` before the first submit. */
export type ArchiveActionState = ArchiveDepotResult | UnarchiveDepotResult | { ok: false; reason: "unauthorized" } | null;

const idInput = z.object({ id: formText });

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

export async function archiveDepotAction(_previous: ArchiveActionState, formData: FormData): Promise<ArchiveActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const { id } = idInput.parse({ id: formData.get("id") });
  if (!id) return { ok: false, reason: "not-found" };
  const result = await archiveDepot(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function unarchiveDepotAction(_previous: ArchiveActionState, formData: FormData): Promise<ArchiveActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const { id } = idInput.parse({ id: formData.get("id") });
  if (!id) return { ok: false, reason: "not-found" };
  const result = await unarchiveDepot(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
