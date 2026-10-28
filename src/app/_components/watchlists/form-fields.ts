/**
 * FormData names shared by the watchlist dialogs and `src/app/_actions/watchlists.ts`, so a rename on
 * either side fails typecheck instead of silently breaking a form.
 */
export const WATCHLIST_FIELDS = {
  /** The list (create/rename/delete), the list to add to, or the list to move an entry to. */
  watchlistId: "watchlistId",
  name: "name",
  entryId: "entryId",
  securityId: "securityId",
  /** `NEW_SECURITY_MARKER` when "Neue Security anlegen" is chosen. */
  newSecurity: "newSecurity",
  securityIdentifier: "securityIdentifier",
  securityName: "securityName",
  assetType: "assetType",
  note: "note",
  dateAdded: "dateAdded",
} as const;

/** Value of the `newSecurity` field when "Neue Security anlegen" is chosen. */
export const NEW_SECURITY_MARKER = "1";
