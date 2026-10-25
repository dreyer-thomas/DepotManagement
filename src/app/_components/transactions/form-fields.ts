/**
 * FormData names shared by the Transaction dialog and `saveTransactionAction`, so a rename on
 * either side fails typecheck instead of silently breaking the form.
 */
export const TRADE_FIELDS = {
  depotId: "depotId",
  type: "type",
  date: "date",
  quantity: "quantity",
  price: "price",
  fee: "fee",
  tax: "tax",
  /** The single value field of non-trades ("Betrag"/"Bruttobetrag"); FEE/TAX map it to fee/tax. */
  amount: "amount",
  securityId: "securityId",
  newSecurity: "newSecurity",
  securityIdentifier: "securityIdentifier",
  securityName: "securityName",
  assetType: "assetType",
  /** Set in edit mode: the Transaction being edited. */
  transactionId: "transactionId",
  /** `ALLOW_DUPLICATE_MARKER` after the user confirmed a possible duplicate ("Trotzdem buchen"). */
  allowDuplicate: "allowDuplicate",
} as const;

export type TradeFieldName = (typeof TRADE_FIELDS)[keyof typeof TRADE_FIELDS];

/** Value of the `newSecurity` field when "Neue Security anlegen" is chosen. */
export const NEW_SECURITY_MARKER = "1";

/** Value of the `allowDuplicate` field when "Trotzdem buchen" is pressed. */
export const ALLOW_DUPLICATE_MARKER = "1";
