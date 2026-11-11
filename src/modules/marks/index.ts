// The marks module owns PriceMark rows (story 12.2): the stop and target of a Security. Its service
// (`setPriceMarks`) is the only write path for the app and MCP; validation and every derived figure
// (effective stop, distances, breach) come from `core/price-marks`, never stored. It reaches Securities and
// corporate actions only through `@/modules/ledger` and Prices only through `@/modules/prices`; marks never
// feed valuations, returns, tax, the ledger or Prices. `backup` exports and restores the rows.
export { getPriceMarks, priceMarkChartLines, priceMarksView, setPriceMarks } from "./marks";
export type { MarksDb, PriceMarksViewItem, SetPriceMarksResult } from "./marks";
export { exportPriceMarks, replaceAllPriceMarks } from "./backup";
export type { PriceMarkExport } from "./backup";
export type {
  PriceMarkBreach,
  PriceMarkField,
  PriceMarkLinePoint,
  PriceMarkLines,
  PriceMarkStopLine,
  PriceMarkProblem,
  PriceMarks,
  PriceMarksInvalid,
  PriceMarksPatch,
  PriceMarkState,
  StopMark,
  StopType,
  TargetMark,
} from "@/core/price-marks";
