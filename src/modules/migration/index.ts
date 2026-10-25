// Parqet migration (FR-15): a pure CSV reader, a read-only preview and the confirmation, which books
// through `ledger.recordBatch` (story 2.4).
export { FLAG_REASONS, PROPOSAL_TYPES, RAW_COLUMNS, readParqetCsv, REQUIRED_COLUMNS } from "./parqet-reader";
export type {
  FlaggedRow,
  RawColumn,
  RawRow,
  FlagReason,
  IsinChangeProposal,
  ParqetReadResult,
  ParqetSecurity,
  ProposalType,
  TransactionProposal,
} from "./parqet-reader";
export { PARQET_MAX_FILE_BYTES } from "./limits";
export { analyzeParqetExport, previewParqetMigration } from "./preview";
export type {
  ParqetAnalysis,
  ParqetPreview,
  PreviewDuplicate,
  PreviewFailure,
  PreviewIsinChange,
  PreviewFailureReason,
  PreviewFigures,
  PreviewPosition,
  PreviewResult,
  PreviewSecurity,
} from "./preview";
export {
  carryDecisions,
  CLASSIFICATION_TYPES,
  CORRECTION_ASSET_TYPES,
  CORRECTION_TYPES,
  correctionDraft,
  decisionsSchema,
  EMPTY_DECISIONS,
  initialDecisions,
  itemKey,
  needsClassification,
  openDecisions,
  SECURITY_CORRECTION_TYPES,
} from "./decisions";
export type {
  ClassificationType,
  Correction,
  CorrectionType,
  DuplicateDecision,
  FlagDecision,
  MigrationDecisions,
  OpenDecision,
} from "./decisions";
export { confirmParqetMigration, recordOpeningBalance } from "./confirm";
export type {
  BookingFailure,
  BookingItem,
  ConfirmResult,
  CorrectionFieldFailure,
  Figure,
  MigrationSummary,
  OpeningBalanceInput,
  OpeningBalanceResult,
  PositionComparison,
  SaleComparison,
} from "./confirm";
