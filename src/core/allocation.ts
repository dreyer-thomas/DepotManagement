/**
 * Allocation of a Portfolio or Depot by one classification dimension (FR-21, story 7.2): valued holdings
 * grouped by the dimension's effective value, plus cash, as ordered segments with the composition share
 * logic (exact shares sum to 1, display shares to 1.000), and the Positions of each segment. Pure and
 * label-free: the shell passes each holding's group label and the German labels in. No ETF look-through.
 */
import {
  type CompositionCash,
  type CompositionHolding,
  type CompositionSegment,
  type Draft,
  cashDraft,
  finalize,
  group,
  ordered,
} from "./composition";
import { ExactDecimal, canonicalDecimal } from "./decimal";

/** A valued holding with its group label in the chosen dimension (`null` = unclassified). */
export type AllocationHolding = CompositionHolding & { group: string | null };

export type AllocationLabels = { cash: string; unknown: string };

/** One Position of a segment; the same Security in two Depots gives two rows. */
export type AllocationPosition = {
  securityId: string;
  securityName: string;
  depotId: string;
  depotName: string;
  /** Decimal string. */
  value: string;
  /** Exact `value / total of the scope incl. cash` (decimal string). */
  share: string;
};

export type Allocation = {
  segments: CompositionSegment[];
  /** Positions per segment key (`group:<label>` / `unknown`), value descending; no entry for cash. */
  positions: Record<string, AllocationPosition[]>;
};

export const ALLOCATION_UNKNOWN_KEY = "unknown";

/** Decimal places of an exact Position share (as composition shares). */
const SHARE_DECIMALS = 30;

/**
 * Segments: classified groups by amount descending (ties by label, de-DE), then the unclassified ones
 * ("Unbekannt"), then cash last. A group named like the unknown label counts as unclassified.
 */
export function allocation(holdings: readonly AllocationHolding[], cash: CompositionCash, labels: AllocationLabels): Allocation {
  const isUnknown = (holding: AllocationHolding) => holding.group === null || holding.group === labels.unknown;
  const keyOf = (holding: AllocationHolding) => (isUnknown(holding) ? ALLOCATION_UNKNOWN_KEY : `group:${holding.group}`);
  const classified = ordered(group(holdings.filter((h) => !isUnknown(h)), keyOf, (h) => h.group as string));
  const unknown: Draft = {
    key: ALLOCATION_UNKNOWN_KEY,
    kind: "item",
    label: labels.unknown,
    amount: holdings.filter(isUnknown).reduce((sum, h) => sum.plus(h.value), new ExactDecimal(0)),
  };
  const segments = finalize([...classified, unknown, cashDraft(cash, labels)]);
  if (segments.length === 0) return { segments, positions: {} };

  const total = segments.reduce((sum, segment) => sum.plus(segment.amount), new ExactDecimal(0));
  const listed = new Set(segments.map((segment) => segment.key));
  const positions: Record<string, AllocationPosition[]> = {};
  for (const holding of holdings) {
    const key = keyOf(holding);
    if (!listed.has(key)) continue;
    (positions[key] ??= []).push({
      securityId: holding.securityId,
      securityName: holding.securityName,
      depotId: holding.depotId,
      depotName: holding.depotName,
      value: canonicalDecimal(holding.value),
      share: canonicalDecimal(new ExactDecimal(holding.value).div(total).toDecimalPlaces(SHARE_DECIMALS, ExactDecimal.ROUND_HALF_UP)),
    });
  }
  for (const list of Object.values(positions)) {
    list.sort(
      (a, b) =>
        new ExactDecimal(b.value).comparedTo(a.value) ||
        a.securityName.localeCompare(b.securityName, "de-DE") ||
        a.depotName.localeCompare(b.depotName, "de-DE"),
    );
  }
  return { segments, positions };
}
