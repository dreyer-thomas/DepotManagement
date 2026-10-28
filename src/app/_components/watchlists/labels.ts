import type { WatchlistSortKey } from "@/core/watchlist";
import type { WatchlistEntryFailureReason, WatchlistFailureReason } from "@/modules/watchlist";
import { transactionErrorMessage } from "../transactions/labels";

export type WatchlistErrorReason = WatchlistFailureReason | "unauthorized";

const WATCHLIST_ERRORS: Record<WatchlistErrorReason, string> = {
  "name-empty": "Bitte einen Namen eingeben.",
  "name-too-long": "Höchstens 60 Zeichen.",
  "name-taken": "Name ist schon vergeben",
  "not-found": "Watchlist nicht gefunden.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a failed list write (create, rename, delete). */
export function watchlistErrorMessage(reason: WatchlistErrorReason): string {
  return WATCHLIST_ERRORS[reason];
}

/** The name field shows name errors; the rest go to an Alert. */
export function watchlistErrorField(reason: WatchlistErrorReason): "name" | undefined {
  return reason === "name-empty" || reason === "name-too-long" || reason === "name-taken" ? "name" : undefined;
}

export type WatchlistEntryErrorReason = WatchlistEntryFailureReason | "unauthorized";

const ENTRY_ERRORS: Partial<Record<WatchlistEntryErrorReason, string>> = {
  "watchlist-not-found": "Watchlist nicht gefunden.",
  "security-not-found": "Bitte ein Wertpapier wählen.",
  "not-found": "Eintrag nicht gefunden.",
  "already-on-list": "Steht schon auf dieser Liste",
  "note-too-long": "Höchstens 2000 Zeichen.",
  "date-invalid": "Bitte ein gültiges Datum bis heute wählen.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a failed entry write; ledger reasons of a new Security use the Transaction form's texts. */
export function watchlistEntryErrorMessage(reason: WatchlistEntryErrorReason): string {
  return ENTRY_ERRORS[reason] ?? transactionErrorMessage(reason as Parameters<typeof transactionErrorMessage>[0]);
}

export type WatchlistEntryField = "security" | "securityIdentifier" | "securityName" | "assetType" | "note" | "dateAdded" | "watchlist";

/** Which entry-form field an error belongs to; `undefined` → Alert. */
export function watchlistEntryErrorField(reason: WatchlistEntryErrorReason): WatchlistEntryField | undefined {
  switch (reason) {
    case "security-not-found":
    case "already-on-list":
      return "security";
    case "isin-invalid":
    case "crypto-symbol-invalid":
      return "securityIdentifier";
    case "security-name-invalid":
      return "securityName";
    case "asset-type-invalid":
      return "assetType";
    case "note-too-long":
      return "note";
    case "date-invalid":
      return "dateAdded";
    default:
      return undefined;
  }
}

/** "1 Eintrag" / "3 Einträge". */
export function entryCountText(count: number): string {
  return count === 1 ? "1 Eintrag" : `${count} Einträge`;
}

/** Question of the "Watchlist löschen" dialog, naming the list and (if any) its entry count. */
export function deleteWatchlistQuestion(name: string, entryCount: number): string {
  // Dative after "mit": "1 Eintrag", "3 Einträgen".
  const entries = entryCount === 0 ? "" : entryCount === 1 ? " mit 1 Eintrag" : ` mit ${entryCount} Einträgen`;
  return `Watchlist „${name}“${entries} löschen? Die Wertpapiere und ihre Kurse bleiben erhalten.`;
}

export const WATCHLIST_SORT_LABELS: Record<WatchlistSortKey, string> = {
  name: "Wertpapier",
  changeToday: "Heute",
  sinceAdded: "Seit Aufnahme",
  dateAdded: "Aufgenommen",
};

/** Direction a column starts in when first chosen: names A→Z, figures and dates largest / newest first. */
export function initialWatchlistSortDirection(key: WatchlistSortKey): "asc" | "desc" {
  return key === "name" ? "asc" : "desc";
}

export const HELD_LABEL = "im Bestand";
export const VIA_CLAUDE_LABEL = "via Claude";
