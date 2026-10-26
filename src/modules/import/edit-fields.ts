// Which proposal fields the review may edit per type (story 5.3). Pure and client-safe: the review UI
// imports it directly; type, ISIN and name are never editable.
import type { ProposalType } from "./proposal";

/** Fields of a proposal the review may edit (type, ISIN and name stay as read). */
export const EDITABLE_PROPOSAL_FIELDS = ["date", "quantity", "price", "amount", "fee", "tax"] as const;
export type EditableProposalField = (typeof EDITABLE_PROPOSAL_FIELDS)[number];

/** The fields an edit may change for a proposal type (the others are ignored). */
export function editableFields(type: ProposalType): EditableProposalField[] {
  if (type === "BUY" || type === "SELL") return ["date", "quantity", "price", "amount", "fee", "tax"];
  if (type === "DIVIDEND") return ["date", "amount", "fee", "tax"];
  if (type === "FEE") return ["date", "fee"];
  return ["date", "tax"];
}
