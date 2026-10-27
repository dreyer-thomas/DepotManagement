// The classification module owns SecurityClassification rows (AD-20). Every analysis reads
// classifications only through this entry point; other modules never touch its table.
export {
  CLASSIFICATION_TEXT_MAX_LENGTH,
  listClassifications,
  MANUAL_VALUE_SCHEMAS,
  refreshClassifications,
  setManualClassification,
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
  ManualClassificationInput,
  SetManualClassificationResult,
} from "./classification";
export { exportClassifications, replaceAllClassifications } from "./backup";
export type { ClassificationExport } from "./backup";
