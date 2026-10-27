// The rebalancing module owns TargetAllocation rows (story 8.5): target weights and threshold per scope
// (the Portfolio or a Depot). It checks Depots only via `@/modules/ledger`; it never writes ledger rows and
// never stores proposals (they are computed on read by `core/rebalancing`).
export { getTargetAllocation, PORTFOLIO_TARGET_SCOPE, setTargetAllocation } from "./targets";
export type { RebalancingDb, SetTargetAllocationFailureReason, SetTargetAllocationResult, TargetAllocation } from "./targets";
export { exportTargetAllocations, replaceAllTargetAllocations } from "./backup";
export type { TargetAllocationExport } from "./backup";
