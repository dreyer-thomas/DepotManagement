"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseDecimalInput } from "@/core/decimal-input";
import { getSession } from "@/modules/auth";
import {
  bookImportBatch,
  type BookImportBatchResult,
  createImportBatch,
  type CreateImportBatchFailureReason,
  decideProposal,
  type DecideProposalResult,
  discardImportBatch,
  EDITABLE_PROPOSAL_FIELDS,
  type EditableProposalField,
  IMPORT_MAX_BATCH_BYTES,
  IMPORT_MAX_FILES,
  type ProposalEdit,
  updateProposal,
  type UpdateProposalResult,
} from "@/modules/import";
import { schedulePriceBackfill } from "./price-refresh";

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

/** Result of a Buchen/Verwerfen toggle. */
export type DecideProposalActionState = DecideProposalResult | Unauthorized;

/** Result of an inline edit; `invalid` names the field (German message in the UI). */
export type UpdateProposalActionState = UpdateProposalResult | Unauthorized;

/** Result of "N Buchungen buchen". */
export type BookImportBatchActionState = BookImportBatchResult | Unauthorized;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const index = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) ? value : -1);

function batchPath(batchId: string): string {
  return `/import/${encodeURIComponent(batchId)}`;
}

/** Stores the decision (`"book"`, `"discard"` or `null`) of proposal `proposalIndex` of item `itemId`. */
export async function decideProposalAction(
  batchId: string,
  itemId: string,
  proposalIndex: number,
  decision: "book" | "discard" | null,
): Promise<DecideProposalActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const value = decision === "book" || decision === "discard" ? decision : null;
  const result = await decideProposal(text(batchId), text(itemId), index(proposalIndex), value);
  if (result.ok) revalidatePath(batchPath(text(batchId)));
  return result;
}

const DECIMAL_FIELDS: readonly EditableProposalField[] = ["quantity", "price", "amount", "fee", "tax"];

/**
 * Edits proposal `proposalIndex` of item `itemId`: `fields` holds the form text per field (German decimals,
 * `YYYY-MM-DD` date); figures are parsed to canonical decimals here, the service validates the result.
 */
export async function updateProposalAction(
  batchId: string,
  itemId: string,
  proposalIndex: number,
  fields: Record<string, unknown>,
): Promise<UpdateProposalActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const edit: ProposalEdit = {};
  for (const field of EDITABLE_PROPOSAL_FIELDS) {
    const value = fields && typeof fields === "object" ? fields[field] : undefined;
    if (typeof value !== "string") continue;
    if (!DECIMAL_FIELDS.includes(field)) {
      edit[field] = value.trim();
      continue;
    }
    const parsed = parseDecimalInput(value);
    if (!parsed.ok) return { ok: false, reason: "invalid", field, issue: `${field}-invalid` };
    edit[field] = parsed.value;
  }
  const result = await updateProposal(text(batchId), text(itemId), index(proposalIndex), edit);
  if (result.ok) revalidatePath(batchPath(text(batchId)));
  return result;
}

const keyList = z.array(z.string()).max(10_000);

/**
 * Books batch `batchId`: `expectedKeys` is the JSON array of proposal keys the page showed as booked;
 * the service books only when the current review books exactly these. On success revalidates every page
 * and schedules a price backfill (prices and logos of new Securities).
 */
export async function bookImportBatchAction(batchId: string, expectedKeys: string): Promise<BookImportBatchActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  let keys: string[];
  try {
    keys = keyList.parse(JSON.parse(text(expectedKeys)));
  } catch {
    return { ok: false, reason: "review-changed" };
  }
  const result = await bookImportBatch(text(batchId), keys);
  if (result.ok) {
    revalidatePath("/", "layout");
    schedulePriceBackfill();
  }
  return result;
}
