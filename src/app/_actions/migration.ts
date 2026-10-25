"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseDecimalInput } from "@/core/decimal-input";
import { getSession } from "@/modules/auth";
import {
  type ConfirmResult,
  confirmParqetMigration,
  decisionsSchema,
  type OpeningBalanceResult,
  PARQET_MAX_FILE_BYTES,
  previewParqetMigration,
  type PreviewResult,
  recordOpeningBalance,
} from "@/modules/migration";

type Unauthorized = { ok: false; reason: "unauthorized" };
type FileFailure = { ok: false; reason: "file-missing" | "file-too-large" };

/** Result of the preview action; `null` before the first submit. */
export type PreviewParqetActionState = PreviewResult | Unauthorized | FileFailure | null;

/** Result of the confirm action. */
export type ConfirmParqetActionResult = ConfirmResult | Unauthorized | FileFailure | { ok: false; reason: "decisions-invalid" };

/** Result of the opening-balance action. */
export type OpeningBalanceActionResult = OpeningBalanceResult | Unauthorized;

const UNAUTHORIZED: Unauthorized = { ok: false, reason: "unauthorized" };

const upload = z.object({
  // Non-string values become "", which is an unknown Depot.
  depotId: z.string().trim().catch(""),
  // Anything but a non-empty uploaded file counts as missing.
  file: z
    .instanceof(File)
    .refine((file) => file.size > 0 || file.name !== "")
    .nullable()
    .catch(null),
});

type Upload = { ok: true; depotId: string; text: string } | FileFailure | { ok: false; reason: "depot-not-found" };

async function readUpload(formData: FormData): Promise<Upload> {
  const { depotId, file } = upload.parse({ depotId: formData.get("depotId"), file: formData.get("file") });
  if (!file) return { ok: false, reason: "file-missing" };
  if (file.size > PARQET_MAX_FILE_BYTES) return { ok: false, reason: "file-too-large" };
  if (!depotId) return { ok: false, reason: "depot-not-found" };
  return { ok: true, depotId, text: await file.text() };
}

/** Reads the uploaded Parqet CSV for the chosen Depot and returns the preview. Writes nothing. */
export async function previewParqetAction(
  _previous: PreviewParqetActionState,
  formData: FormData,
): Promise<PreviewParqetActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const read = await readUpload(formData);
  if (!read.ok) return read;
  return previewParqetMigration(read.depotId, read.text);
}

/** Parses the `decisions` field (JSON); `null` when it is missing, not JSON or not valid decisions. */
function parseDecisions(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  try {
    const parsed = decisionsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Books the uploaded Parqet CSV into the chosen Depot with the user's `decisions` (JSON). The server
 * re-reads the file and re-checks it against the current ledger. Revalidates after a booking.
 */
export async function confirmParqetAction(formData: FormData): Promise<ConfirmParqetActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const read = await readUpload(formData);
  if (!read.ok) return read;
  const decisions = parseDecisions(formData.get("decisions"));
  if (!decisions) return { ok: false, reason: "decisions-invalid" };
  const result = await confirmParqetMigration(read.depotId, read.text, decisions);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const openingForm = z.object({
  depotId: z.string().trim().catch(""),
  date: z.string().trim().catch(""),
  asOf: z.string().trim().catch(""),
  balance: z.string().catch(""),
});

/**
 * Books the opening cash difference for a migrated file without Cash rows: `balance` is the broker's
 * balance at `asOf` (German decimal input), booked on `date`. Revalidates when something was booked.
 */
export async function openingBalanceAction(formData: FormData): Promise<OpeningBalanceActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const form = openingForm.parse(Object.fromEntries(["depotId", "date", "asOf", "balance"].map((key) => [key, formData.get(key)])));
  const balance = parseDecimalInput(form.balance);
  if (!balance.ok || balance.value === "") return { ok: false, reason: "balance-invalid" };
  const result = await recordOpeningBalance({ depotId: form.depotId, date: form.date, asOf: form.asOf, balance: balance.value });
  if (result.ok && result.transaction) revalidatePath("/", "layout");
  return result;
}
