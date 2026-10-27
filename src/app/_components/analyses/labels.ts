import type { AllocationHolding, AllocationLabels } from "@/core/allocation";
import type { CompositionHolding, CompositionSegment } from "@/core/composition";
import { formatMoney, formatShare } from "@/core/format";
import type { AssetType } from "@/modules/ledger";
import type { Classification } from "@/modules/classification";
import { ASSET_TYPE_LABELS } from "../transactions/labels";

/** Analysen tabs, driven by `?tab=`; later stories add Rendite, Gewinne and Dividenden. */
export const ANALYSIS_TABS = [{ value: "allocation", label: "Aufteilung" }] as const;

export type AnalysisTab = (typeof ANALYSIS_TABS)[number]["value"];

export const DEFAULT_ANALYSIS_TAB: AnalysisTab = "allocation";

/** The tab named by a `?tab=` value; unknown or missing values give the default. */
export function analysisTab(value: string | string[] | undefined): AnalysisTab {
  const raw = first(value);
  return ANALYSIS_TABS.find((tab) => tab.value === raw)?.value ?? DEFAULT_ANALYSIS_TAB;
}

export const analysisTabId = (tab: AnalysisTab) => `analysis-tab-${tab}`;
export const analysisTabPanelId = (tab: AnalysisTab) => `analysis-tabpanel-${tab}`;

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

export const DEFAULT_ALLOCATION_DIMENSION: AllocationDimension = "assetClass";

/** Scope value of the whole Portfolio (all non-archived Depots); otherwise the scope is a Depot id. */
export const PORTFOLIO_SCOPE = "portfolio";
export const PORTFOLIO_LABEL = "Portfolio";

export const ALLOCATION_LABELS: AllocationLabels = { cash: "Guthaben", unknown: "Unbekannt" };

export const NOT_APPLICABLE_LABEL = "Nicht zutreffend";

export const ALLOCATION_EMPTY_TEXT = "Keine Werte vorhanden.";
export const ALLOCATION_CASH_TEXT = "Guthaben der Cash-Konten – keine Positionen.";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?scope=`: a known (non-archived) Depot id, else the Portfolio. */
export function analysisScope(value: string | string[] | undefined, depotIds: readonly string[]): string {
  const raw = first(value);
  return raw !== undefined && depotIds.includes(raw) ? raw : PORTFOLIO_SCOPE;
}

/** `?dimension=`: a known dimension, else Anlageklasse. */
export function allocationDimension(value: string | string[] | undefined): AllocationDimension {
  const raw = first(value);
  return raw !== undefined && Object.hasOwn(ALLOCATION_DIMENSIONS, raw) ? (raw as AllocationDimension) : DEFAULT_ALLOCATION_DIMENSION;
}

/** URL of the allocation tab with the given scope and dimension. */
export function allocationHref(scope: string, dimension: AllocationDimension): string {
  const params = new URLSearchParams({ tab: "allocation", scope, dimension });
  return `/analyses?${params.toString()}`;
}

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

/** Composition holdings with their group in the dimension. */
export function allocationHoldings(
  holdings: readonly CompositionHolding[],
  classifications: Readonly<Record<string, Classification>>,
  dimension: AllocationDimension,
): AllocationHolding[] {
  return holdings.map((holding) => ({ ...holding, group: groupOf(classifications[holding.securityId], dimension) }));
}

/** Text alternative of the donut: `Aufteilung nach Sektor: Technologie 60,0 % (600,00 €), …`. */
export function allocationAriaLabel(dimensionLabel: string, segments: readonly CompositionSegment[]): string {
  const parts = segments.map((s) => `${s.label} ${formatShare(s.displayShare)} (${formatMoney(s.amount)})`);
  return `Aufteilung nach ${dimensionLabel}: ${parts.join(", ")}`;
}
