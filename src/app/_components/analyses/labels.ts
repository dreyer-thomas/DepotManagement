import type { AllocationHolding, AllocationLabels } from "@/core/allocation";
import type { CompositionHolding, CompositionSegment } from "@/core/composition";
import Decimal from "decimal.js";
import { formatMoney, formatShare } from "@/core/format";
import type { AssetType } from "@/modules/ledger";
import type { Classification } from "@/modules/classification";
import { ratioTone } from "../security-detail/labels";
import { ASSET_TYPE_LABELS } from "../transactions/labels";

/** Analysen tabs, driven by `?tab=`; later stories add Gewinne and Dividenden. */
export const ANALYSIS_TABS = [
  { value: "allocation", label: "Aufteilung" },
  { value: "returns", label: "Rendite" },
] as const;

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

/** URL of an Analysen tab; scope and dimension stay in the URL on every tab, so switching keeps them. */
export function analysisHref(tab: AnalysisTab, scope: string, dimension: AllocationDimension): string {
  const params = new URLSearchParams({ tab, scope, dimension });
  return `/analyses?${params.toString()}`;
}

/** URL of the allocation tab with the given scope and dimension. */
export function allocationHref(scope: string, dimension: AllocationDimension): string {
  return analysisHref("allocation", scope, dimension);
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

/** Column labels of the return heatmap. */
export const HEATMAP_MONTH_LABELS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"] as const;
export const HEATMAP_QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"] as const;
export const HEATMAP_YEAR_LABEL = "Jahr";
export const HEATMAP_RUNNING_LABEL = "laufend";
export const HEATMAP_EMPTY_TEXT = "Noch keine Transaktionen.";

/** |r| at which a heatmap cell reaches full intensity. */
export const HEATMAP_INTENSITY_CAP = "0.1";

export type HeatmapTone = { tone: "gain" | "loss" | "neutral"; intensity: number };

/**
 * Tint of a heatmap cell by its value as displayed (`ratioTone`): gain above, loss below 0,00 %, neutral
 * when it shows as 0,00 % or `null`; intensity = |r| / 10 %,
 * capped at 1. The cell always shows the signed value too, so colour is never the only cue.
 */
export function heatmapCellTone(ratio: string | null): HeatmapTone {
  const tone = ratioTone(ratio);
  if (ratio === null || tone === null) return { tone: "neutral", intensity: 0 };
  const intensity = Decimal.min(new Decimal(ratio).abs().dividedBy(HEATMAP_INTENSITY_CAP), 1).toNumber();
  return { tone, intensity };
}

/**
 * Opacity of the gain/loss tint over the card surface for an intensity: 0.12 + 0.48·i in light mode;
 * dark mode tops out lower (0.12 + 0.28·i) so the light text keeps WCAG AA contrast on the brighter tints.
 */
export function heatmapTintAlpha(intensity: number, mode: "light" | "dark"): number {
  return 0.12 + (mode === "light" ? 0.48 : 0.28) * intensity;
}
