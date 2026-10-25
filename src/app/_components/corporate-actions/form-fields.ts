/**
 * FormData names shared by the ISIN-change dialog and `saveIsinChangeAction`, so a rename on either
 * side fails typecheck instead of silently breaking the form.
 */
export const ISIN_CHANGE_FIELDS = {
  oldSecurityId: "oldSecurityId",
  /** Set in edit mode: the ISIN change being edited. */
  isinChangeId: "isinChangeId",
  newSecurityId: "newSecurityId",
  /** `NEW_SECURITY_MARKER` when "Neue Security anlegen" is chosen. */
  newSecurity: "newSecurity",
  securityIdentifier: "securityIdentifier",
  securityName: "securityName",
  assetType: "assetType",
  date: "date",
  oldQuantity: "oldQuantity",
  newQuantity: "newQuantity",
} as const;

export { NEW_SECURITY_MARKER } from "@/app/_components/transactions/form-fields";
