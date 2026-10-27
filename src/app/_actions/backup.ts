"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth";
import { RESTORE_MAX_FILE_BYTES, restoreExport, type RestoreResult } from "@/modules/backup";
import { scheduleClassificationRefresh } from "./classification-refresh";

type Unauthorized = { ok: false; reason: "unauthorized" };

/** Result of "Wiederherstellen"; `null` before the first submit. */
export type RestoreActionState = RestoreResult | Unauthorized | null;

/**
 * "Wiederherstellen": replaces all data with the uploaded export file (`file`). The session is checked
 * first and the size before the body is read; the backup service validates the file and writes the
 * automatic export before replacing anything. Revalidates every page on success and schedules a
 * classification refresh (only manual overrides are restored).
 */
export async function restoreAction(_previous: RestoreActionState, formData: FormData): Promise<RestoreActionState> {
  if (!(await getSession())) return { ok: false, reason: "unauthorized" };
  const file = formData.get("file");
  if (!(file instanceof File) || (file.size === 0 && file.name === "")) return { ok: false, reason: "file-missing" };
  if (file.size > RESTORE_MAX_FILE_BYTES) return { ok: false, reason: "file-too-large" };
  const result = await restoreExport(await file.text());
  if (result.ok) {
    revalidatePath("/", "layout");
    scheduleClassificationRefresh();
  }
  return result;
}
