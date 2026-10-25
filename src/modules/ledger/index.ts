// The ledger module is the only writer of ledger rows (Depots now; Transactions and Securities later).
export {
  BROKERS,
  createDepot,
  DEPOT_NAME_MAX_LENGTH,
  getDepot,
  listDepots,
  renameDepot,
} from "./depots";
export type {
  Broker,
  CreateDepotInput,
  DepotFailureReason,
  DepotResult,
  DepotSummary,
  LedgerDb,
  RenameDepotInput,
} from "./depots";
