// Allocation dimensions, labels and grouping of the Analysen › Aufteilung view (story 7.2, region split 8.4).
// Safe to import from client components (no Prisma; type imports and the client-safe ledger labels only).
import type { AllocationHolding, AllocationLabels } from "@/core/allocation";
import type { Classification } from "@/core/classification";
import type { CompositionHolding } from "@/core/composition";
import { distributeByRegion, type RegionWeights } from "@/core/region-split";
import type { AssetType } from "@/modules/ledger";
import { ASSET_TYPE_LABELS } from "@/modules/ledger/labels";

/** Allocation dimensions with their German labels, in selector order. */
export const ALLOCATION_DIMENSIONS = {
  assetClass: "Anlageklasse",
  type: "Wertpapiertyp",
  sector: "Sektor",
  industry: "Branche",
  region: "Region",
  country: "Land",
  companySize: "Unternehmensgröße",
  currency: "Währung",
} as const;

export type AllocationDimension = keyof typeof ALLOCATION_DIMENSIONS;

export const ALLOCATION_LABELS: AllocationLabels = { cash: "Guthaben", unknown: "Unbekannt" };

export const NOT_APPLICABLE_LABEL = "Nicht zutreffend";

/**
 * Group label of a Security in a dimension (effective value, manual wins); `null` = "Unbekannt".
 * Wertpapiertyp uses the ledger's asset type; company size "–" means "Nicht zutreffend".
 */
export function groupOf(classification: Classification | undefined, dimension: AllocationDimension): string | null {
  if (!classification) return null;
  if (dimension === "type") {
    return classification.type === "UNCLASSIFIED" ? null : (ASSET_TYPE_LABELS[classification.type as AssetType] ?? classification.type);
  }
  const value = classification[dimension].value;
  if (value === null) return null;
  if (dimension === "companySize" && value === "–") return NOT_APPLICABLE_LABEL;
  return value;
}

/** The effective region split per Security id (`listRegionSplits`); only `effective.weights` is read. */
export type RegionSplits = Readonly<Record<string, { effective: { weights: RegionWeights } | null }>>;

/**
 * Composition holdings with their group in the dimension. In the "Region" dimension a fund with an effective
 * region split becomes one holding per split region (`distributeByRegion`, with its `weight`); every other
 * holding and dimension keeps its single group.
 */
export function allocationHoldings(
  holdings: readonly CompositionHolding[],
  classifications: Readonly<Record<string, Classification>>,
  dimension: AllocationDimension,
  splits: RegionSplits = {},
): AllocationHolding[] {
  return holdings.flatMap((holding) => {
    const split = dimension === "region" ? splits[holding.securityId]?.effective : null;
    if (split) {
      return distributeByRegion(holding.value, split.weights).map((slice) => ({ ...holding, group: slice.region, value: slice.value, weight: slice.weight }));
    }
    return [{ ...holding, group: groupOf(classifications[holding.securityId], dimension) }];
  });
}
