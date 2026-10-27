// The tax module owns TaxAllowance and TeilfreistellungOverride rows (story 8.3). It reads ledger data
// only via `@/modules/ledger` and classifications only via `@/modules/classification`; it never writes
// ledger rows and never stores tax results (the preview is computed on read by `core/tax`).
export {
  listTaxAllowances,
  listTeilfreistellungOverrides,
  setTaxAllowances,
  setTeilfreistellungOverride,
  TAX_YEAR_MAX,
  TAX_YEAR_MIN,
} from "./settings";
export type {
  SetTaxAllowancesResult,
  SetTeilfreistellungResult,
  TaxAllowanceFailureReason,
  TaxAllowanceRecord,
  TaxDb,
  TeilfreistellungFailureReason,
} from "./settings";
export { taxPreviewInput } from "./preview";
export type { TaxPreviewData } from "./preview";
export { exportTaxSettings, replaceAllTaxSettings } from "./backup";
export type { TaxAllowanceExport, TaxSettingsExport, TeilfreistellungOverrideExport } from "./backup";
