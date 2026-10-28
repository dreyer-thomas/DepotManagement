// The classification module owns SecurityClassification rows (AD-20) and the disposable key-figures
// snapshots (SecurityKeyFigures, story 9.6; never exported). Every analysis reads
// classifications only through this entry point; other modules never touch its table.
export {
  CLASSIFICATION_TEXT_MAX_LENGTH,
  listClassifications,
  listKeyFigures,
  listRegionSplits,
  MANUAL_VALUE_SCHEMAS,
  refreshClassifications,
  refreshKeyFigures,
  setManualClassification,
  setManualRegionSplit,
} from "./classification";
export type {
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
  SetManualClassificationResult,
  SetManualRegionSplitResult,
} from "./classification";
export type { EffectiveRegionSplit, RegionWeight, RegionWeights, RuleRegionSplit, SplitRegion } from "@/core/region-split";
export { exportClassifications, replaceAllClassifications } from "./backup";
export type { ClassificationExport } from "./backup";
