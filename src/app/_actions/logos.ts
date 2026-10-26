"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth";
import { saveManualLogo, type SaveManualLogoResult, UPLOAD_MAX_BYTES } from "@/modules/logos";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;
type Unauthorized = typeof UNAUTHORIZED;

/** Result of "Logo hochladen"; `null` before the first submit. */
export type UploadLogoActionState = SaveManualLogoResult | Unauthorized | null;

/**
 * "Logo hochladen": stores the uploaded file (`file`) as the manual logo of Security `securityId`.
 * The session is checked first; the service checks size and format (magic bytes). Revalidates on success.
 */
export async function uploadLogoAction(_previous: UploadLogoActionState, formData: FormData): Promise<UploadLogoActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const securityId = formData.get("securityId");
  const file = formData.get("file");
  // Checked before reading the body; the service re-checks the bytes.
  if (file instanceof File && file.size > UPLOAD_MAX_BYTES) return { ok: false, reason: "file-too-large" };
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(0);
  const result = await saveManualLogo(typeof securityId === "string" ? securityId.trim() : "", bytes);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
