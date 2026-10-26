import type { DiscardImportBatchActionState, UploadDocumentsActionState } from "@/app/_actions/import";
import type { ImportItemStatus } from "@/modules/import";

/** Status chip text per item status. */
export const ITEM_STATUS_LABELS: Record<ImportItemStatus, string> = {
  PARSED: "erkannt",
  FAILED: "fehlgeschlagen",
};

/** Warning on an item whose file bytes were uploaded before. */
export const REUPLOAD_WARNING = "Diese Datei wurde bereits hochgeladen.";

export const ACTION_FAILED_MESSAGE = "Verbindung fehlgeschlagen. Bitte erneut versuchen.";

export type UploadErrorReason = Extract<NonNullable<UploadDocumentsActionState>, { ok: false }>["reason"] | "action-failed";
export type DiscardErrorReason = Extract<NonNullable<DiscardImportBatchActionState>, { ok: false }>["reason"] | "action-failed";

const UPLOAD_ERROR_MESSAGES: Record<UploadErrorReason, string> = {
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "files-missing": "Bitte mindestens eine PDF-Datei auswählen.",
  "too-many-files": "Höchstens 50 Dateien auf einmal.",
  "upload-too-large": "Zusammen höchstens 20 MB. Bitte weniger Dateien auf einmal hochladen.",
  "depot-not-found": "Depot nicht gefunden.",
  "depot-archived": "Depot ist archiviert. Bitte zuerst reaktivieren.",
  "action-failed": ACTION_FAILED_MESSAGE,
};

/** German message for a rejected upload. */
export function uploadErrorMessage(reason: UploadErrorReason): string {
  return UPLOAD_ERROR_MESSAGES[reason];
}

const DISCARD_ERROR_MESSAGES: Record<DiscardErrorReason, string> = {
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "not-found": "Import nicht gefunden.",
  "action-failed": ACTION_FAILED_MESSAGE,
};

/** German message for a failed discard. */
export function discardErrorMessage(reason: DiscardErrorReason): string {
  return DISCARD_ERROR_MESSAGES[reason];
}

/** "1 Datei" / "N Dateien". */
export function fileCountLabel(count: number): string {
  return count === 1 ? "1 Datei" : `${count} Dateien`;
}

/** Summary line of a batch: "N Dateien · X erkannt · Y fehlgeschlagen". */
export function batchSummary(counts: { fileCount: number; parsedCount: number; failedCount: number }): string {
  return `${fileCountLabel(counts.fileCount)} · ${counts.parsedCount} erkannt · ${counts.failedCount} fehlgeschlagen`;
}

/** Item counts of a batch's items. */
export function itemCounts(items: readonly { status: ImportItemStatus }[]) {
  const parsedCount = items.filter((item) => item.status === "PARSED").length;
  return { fileCount: items.length, parsedCount, failedCount: items.length - parsedCount };
}

/** Megabytes with one decimal, German formatting (for the selection summary); below 0,1 MB "< 0,1 MB". */
export function formatMegabytes(bytes: number): string {
  if (bytes > 0 && bytes < 0.05 * 1024 * 1024) return "< 0,1 MB";
  return `${(bytes / (1024 * 1024)).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
