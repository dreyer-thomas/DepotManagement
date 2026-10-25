// Parqet migration (FR-15): a pure CSV reader and a read-only preview. Booking goes through `ledger` (story 2.4).
export { FLAG_REASONS, PROPOSAL_TYPES, readParqetCsv, REQUIRED_COLUMNS } from "./parqet-reader";
export type {
  FlaggedRow,
  FlagReason,
  IsinChangeProposal,
  ParqetReadResult,
  ParqetSecurity,
  ProposalType,
  TransactionProposal,
} from "./parqet-reader";
export { PARQET_MAX_FILE_BYTES } from "./limits";
export { previewParqetMigration } from "./preview";
export type {
  ParqetPreview,
  PreviewFailureReason,
  PreviewFigures,
  PreviewPosition,
  PreviewResult,
  PreviewSecurity,
} from "./preview";
