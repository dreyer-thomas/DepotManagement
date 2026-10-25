"use server";

import { z } from "zod";
import { getSession } from "@/modules/auth";
import { PARQET_MAX_FILE_BYTES, previewParqetMigration, type PreviewResult } from "@/modules/migration";

/** Result of the preview action; `null` before the first submit. */
export type PreviewParqetActionState =
  | PreviewResult
  | { ok: false; reason: "unauthorized" | "file-missing" | "file-too-large" }
  | null;

const input = z.object({
  // Non-string values become "", which is an unknown Depot.
  depotId: z.string().trim().catch(""),
  // Anything but a non-empty uploaded file counts as missing.
  file: z
    .instanceof(File)
    .refine((file) => file.size > 0 || file.name !== "")
    .nullable()
    .catch(null),
});

/** Reads the uploaded Parqet CSV for the chosen Depot and returns the preview. Writes nothing. */
export async function previewParqetAction(
  _previous: PreviewParqetActionState,
  formData: FormData,
): Promise<PreviewParqetActionState> {
  if (!(await getSession())) return { ok: false, reason: "unauthorized" };
  const { depotId, file } = input.parse({ depotId: formData.get("depotId"), file: formData.get("file") });
  if (!file) return { ok: false, reason: "file-missing" };
  if (file.size > PARQET_MAX_FILE_BYTES) return { ok: false, reason: "file-too-large" };
  if (!depotId) return { ok: false, reason: "depot-not-found" };
  return previewParqetMigration(depotId, await file.text());
}
