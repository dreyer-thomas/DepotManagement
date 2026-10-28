import type { CompositionLabels, CompositionSegment } from "@/core/composition";
import { formatMoney, formatShare } from "@/core/format";
import type { AssetType } from "@/modules/ledger";
import { ASSET_TYPE_LABELS } from "../transactions/labels";

/** German labels handed to the core composition builders. */
export const COMPOSITION_LABELS: CompositionLabels = {
  other: "Sonstige",
  cash: "Guthaben",
  assetType: (type) => (type === "UNCLASSIFIED" ? "Unklassifiziert" : (ASSET_TYPE_LABELS[type as AssetType] ?? type)),
};

export type CompositionView = "position" | "type" | "depot";

/** Toggle labels of the breakdowns, in toggle order. */
export const COMPOSITION_VIEW_LABELS: Record<CompositionView, string> = {
  position: "Position",
  type: "Typ",
  depot: "Depot",
};

export const COMPOSITION_DEFAULT_VIEW: CompositionView = "type";

export const COMPOSITION_EMPTY_TEXT = "Keine Werte vorhanden.";

export { compositionHoldings } from "@/modules/ledger/composition";

/** Text alternative of the donut: `Zusammensetzung nach Typ: ETF 60,0 % (600,00 €), …`. */
export function compositionAriaLabel(viewLabel: string, segments: readonly CompositionSegment[]): string {
  const parts = segments.map((s) => `${s.label} ${formatShare(s.displayShare)} (${formatMoney(s.amount)})`);
  return `Zusammensetzung nach ${viewLabel}: ${parts.join(", ")}`;
}

export type SegmentColorKey = "series1" | "series2" | "series3" | "series4" | "series5" | "cash";

const SERIES: readonly SegmentColorKey[] = ["series1", "series2", "series3", "series4", "series5"];

/** Palette key per segment: non-cash segments cycle through series 1–5 in order, cash takes the cash color. */
export function segmentColorKeys(segments: readonly CompositionSegment[]): SegmentColorKey[] {
  let next = 0;
  return segments.map((segment) => (segment.kind === "cash" ? "cash" : SERIES[next++ % SERIES.length]));
}
