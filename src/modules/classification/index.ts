// The classification module owns SecurityClassification rows (AD-20, incl. the Analysten-Symbol of story
// 9.7) and the disposable key-figures and analyst snapshots (SecurityKeyFigures, stories 9.6/9.7; never exported). Every analysis reads
// classifications only through this entry point; other modules never touch its table.
export {
  CLASSIFICATION_TEXT_MAX_LENGTH,
  listAnalystSymbols,
  listClassifications,
  listKeyFigures,
  listRegionSplits,
  MANUAL_VALUE_SCHEMAS,
  refreshClassifications,
  refreshKeyFigures,
  setAnalystSymbol,
  setManualClassification,
  setManualRegionSplit,
} from "./classification";
export type {
  AnalystSymbolInfo,
  Classification,
  ClassificationDb,
  ClassificationDeps,
  ClassificationFailureReason,
  ClassificationRunResult,
  Dimension,
  DimensionValue,
  EffectiveSource,
  KeyFiguresInfo,
  KeyFiguresSnapshot,
  ManualClassificationInput,
  RefreshKeyFiguresResult,
  RegionSplitFailureReason,
  RegionSplitInfo,
  SetAnalystSymbolResult,
  SetManualClassificationResult,
  SetManualRegionSplitResult,
} from "./classification";
export type { EffectiveRegionSplit, RegionWeight, RegionWeights, RuleRegionSplit, SplitRegion } from "@/core/region-split";
export { exportClassifications, replaceAllClassifications } from "./backup";
export type { ClassificationExport } from "./backup";
