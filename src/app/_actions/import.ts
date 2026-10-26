"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/modules/auth";
import {
  createImportBatch,
  type CreateImportBatchFailureReason,
  discardImportBatch,
  IMPORT_MAX_BATCH_BYTES,
  IMPORT_MAX_FILES,
} from "@/modules/import";

type Unauthorized = { ok: false; reason: "unauthorized" };
const UNAUTHORIZED: Unauthorized = { ok: false, reason: "unauthorized" };

/** Result of "Dokumente hochladen"; `null` before the first submit. Success redirects to the batch. */
export type UploadDocumentsActionState = { ok: false; reason: CreateImportBatchFailureReason } | Unauthorized | null;

/** Result of "Verwerfen"; `null` before the first submit. Success redirects to `/import`. */
export type DiscardImportBatchActionState = { ok: false; reason: "not-found" } | Unauthorized | null;

const uploadForm = z.object({
  // Non-string values become "", which is an unknown Depot.
  depotId: z.string().trim().catch(""),
  // Only non-empty uploaded files count; an empty file input submits one nameless, empty File.
  files: z.array(z.unknown()).transform((values) => values.filter((value): value is File => value instanceof File && (value.size > 0 || value.name !== ""))),
});

/**
 * Stages the uploaded PDFs (`files`, several) for Depot `depotId` as one import batch and opens its batch
 * view. Count and total size are checked before the file bytes are copied for the service (Next has already
 * parsed the body within the server-action body limit); the service re-checks everything.
 */
export async function uploadDocumentsAction(
  _previous: UploadDocumentsActionState,
  formData: FormData,
): Promise<UploadDocumentsActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const { depotId, files } = uploadForm.parse({ depotId: formData.get("depotId"), files: formData.getAll("files") });
  if (files.length === 0) return { ok: false, reason: "files-missing" };
  if (files.length > IMPORT_MAX_FILES) return { ok: false, reason: "too-many-files" };
  if (files.reduce((sum, file) => sum + file.size, 0) > IMPORT_MAX_BATCH_BYTES) return { ok: false, reason: "upload-too-large" };
  const uploads = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
  const result = await createImportBatch(depotId, uploads);
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  redirect(`/import/${encodeURIComponent(result.batchId)}`);
}

/** Discards open batch `batchId` (rows and PDFs) and returns to `/import`. */
export async function discardImportBatchAction(
  _previous: DiscardImportBatchActionState,
  formData: FormData,
): Promise<DiscardImportBatchActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const batchId = formData.get("batchId");
  const result = await discardImportBatch(typeof batchId === "string" ? batchId.trim() : "");
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  redirect("/import");
}
