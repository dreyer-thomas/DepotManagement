// German texts of the restore UI (story 6.2) and the daily DB backup status (story 6.3).
import type { RestoreActionState } from "@/app/_actions/backup";
import { ACTION_FAILED_MESSAGE } from "@/app/_components/import/labels";
import { RESTORE_MAX_FILE_BYTES } from "@/modules/backup/limits";

export { ACTION_FAILED_MESSAGE };

/** The text Tommy must type to enable the restore. */
export const RESTORE_CONFIRM_TEXT = "WIEDERHERSTELLEN";

export const RESTORE_WARNING =
  "Alle Daten werden durch den Inhalt der Datei ersetzt. Vorher wird automatisch ein Export der aktuellen Daten im Sicherungsordner abgelegt. Verbundene Apps (z. B. Claude) müssen danach neu verbunden werden.";

type RestoreFailure = Extract<NonNullable<RestoreActionState>, { ok: false }>;
export type RestoreErrorReason = RestoreFailure["reason"] | "action-failed";

const UNCHANGED = "Es wurde nichts geändert.";

const MESSAGES: Record<RestoreErrorReason, string> = {
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "file-missing": "Bitte eine Exportdatei wählen.",
  "file-too-large": `Die Datei ist größer als ${RESTORE_MAX_FILE_BYTES / (1024 * 1024)} MB.`,
  "not-json": "Die Datei ist keine JSON-Datei.",
  "version-unsupported": "Die Datei stammt aus einer neueren Version von DepotManagement und kann nicht gelesen werden.",
  "schema-invalid": "Die Datei ist keine gültige Exportdatei.",
  inconsistent: "Die Datei ist in sich widersprüchlich.",
  "logo-invalid": "Ein Logo in der Datei ist ungültig.",
  "backup-failed": `Der automatische Export konnte nicht gespeichert werden. ${UNCHANGED}`,
  "restore-failed": `Wiederherstellen fehlgeschlagen. ${UNCHANGED}`,
  "action-failed": ACTION_FAILED_MESSAGE,
};

/** The German Alert text of a failed restore; schema and consistency errors name the field path. */
export function restoreErrorMessage(reason: RestoreErrorReason, detail?: string): string {
  const message = MESSAGES[reason];
  if ((reason === "schema-invalid" || reason === "inconsistent") && detail) return `${message} Stelle: ${detail}`;
  return message;
}

export function restoreSuccessMessage(backupFileName: string): string {
  return `Daten wiederhergestellt. Automatischer Export: ${backupFileName}`;
}

/** Warning when the last DB backup failed; `lastSuccess` is a formatted `DD.MM.YYYY, HH:mm` or null. */
export function backupFailedWarning(lastSuccess: string | null): string {
  const since = lastSuccess
    ? `Letzte erfolgreiche Sicherung: ${lastSuccess}.`
    : "Noch keine erfolgreiche Sicherung.";
  return `Die letzte Datenbanksicherung ist fehlgeschlagen. ${since}`;
}

/** Secondary line with the time of the last successful DB backup (`DD.MM.YYYY, HH:mm`). */
export function lastBackupLine(lastSuccess: string): string {
  return `Letzte Datenbanksicherung: ${lastSuccess}`;
}
