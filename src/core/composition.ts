/**
 * Composition of a Portfolio or Depot (FR13): valued holdings plus cash turned into ordered segments
 * with exact shares and display shares that sum to exactly 100,0 %. Pure and label-free: the shell
 * passes the German labels in. No ETF look-through.
 */
import { ExactDecimal, canonicalDecimal } from "./decimal";

type Decimal = InstanceType<typeof ExactDecimal>;

/** One valued open Position (a Position without a price is not a holding). */
export type CompositionHolding = {
  securityId: string;
  securityName: string;
  assetType: string;
  depotId: string;
  depotName: string;
  /** Position value as a decimal string. */
  value: string;
};

export type CompositionSegment = {
  key: string;
  kind: "item" | "other" | "cash";
  label: string;
  /** Decimal string. */
  amount: string;
  /** Exact `amount / total` (decimal string); all shares sum to exactly 1. */
  share: string;
  /** Share rounded to 0,1 %-steps (ratio with 3 decimals); all display shares sum to exactly 1.000 (non-negative amounts). */
  displayShare: string;
};

export type CompositionLabels = {
  other: string;
  cash: string;
  assetType: (type: string) => string;
};

/** A single cash balance or several (one per Depot), summed. */
export type CompositionCash = string | readonly string[];

/** Default number of Securities shown before the rest is merged into "Sonstige". */
export const COMPOSITION_POSITION_LIMIT = 8;

/** Decimal places of an exact share; the residual of the division goes to the largest segment. */
const SHARE_DECIMALS = 30;
/** Display units per whole: 0,1 %-steps. */
const UNITS = 1000;

/** A segment before its shares are computed (shared with `core/allocation`). */
export type Draft = { key: string; kind: CompositionSegment["kind"]; label: string; amount: Decimal };

function sumCash(cash: CompositionCash): Decimal {
  const values = typeof cash === "string" ? [cash] : cash;
  return values.reduce((total, value) => total.plus(value), new ExactDecimal(0));
}

/** Sums the holdings per group key, keeping the first label seen. */
export function group<H extends CompositionHolding>(holdings: readonly H[], keyOf: (h: H) => string, labelOf: (h: H) => string): Draft[] {
  const groups = new Map<string, Draft>();
  for (const holding of holdings) {
    const key = keyOf(holding);
    const current = groups.get(key);
    if (current) current.amount = current.amount.plus(holding.value);
    else groups.set(key, { key, kind: "item", label: labelOf(holding), amount: new ExactDecimal(holding.value) });
  }
  return [...groups.values()];
}

/** Non-zero items by amount descending, ties by label (de-DE). */
export function ordered(items: Draft[]): Draft[] {
  return items
    .filter((item) => !item.amount.isZero())
    .sort((a, b) => b.amount.comparedTo(a.amount) || a.label.localeCompare(b.label, "de-DE"));
}

/** Display shares in units of 0,1 %: largest remainder (sum exactly 1000), or half-up with a negative amount. */
function displayUnits(drafts: readonly Draft[], total: Decimal): Decimal[] {
  const exact = drafts.map((draft) => draft.amount.times(UNITS).div(total));
  if (drafts.some((draft) => draft.amount.isNegative())) {
    return exact.map((units) => units.toDecimalPlaces(0, ExactDecimal.ROUND_HALF_UP));
  }
  const floors = exact.map((units) => units.floor());
  let missing = floors.reduce((sum, units) => sum.minus(units), new ExactDecimal(UNITS)).toNumber();
  const byRemainder = exact
    .map((units, index) => ({ index, remainder: units.minus(floors[index]) }))
    .sort(
      (a, b) =>
        b.remainder.comparedTo(a.remainder) || drafts[b.index].amount.comparedTo(drafts[a.index].amount) || a.index - b.index,
    );
  for (const { index } of byRemainder) {
    if (missing <= 0) break;
    floors[index] = floors[index].plus(1);
    missing--;
  }
  return floors;
}

/** Exact shares (sum 1) and display shares (sum 1.000) for the non-zero drafts; empty when the total is not positive. */
export function finalize(drafts: Draft[]): CompositionSegment[] {
  const segments = drafts.filter((draft) => !draft.amount.isZero());
  const total = segments.reduce((sum, draft) => sum.plus(draft.amount), new ExactDecimal(0));
  if (total.lte(0)) return [];
  const shares = segments.map((draft) => draft.amount.div(total).toDecimalPlaces(SHARE_DECIMALS, ExactDecimal.ROUND_HALF_UP));
  // The residual of the rounded division goes to the largest segment, so the shares sum to exactly 1.
  let largest = 0;
  segments.forEach((draft, index) => {
    if (draft.amount.gt(segments[largest].amount)) largest = index;
  });
  const residual = shares.reduce((rest, share) => rest.minus(share), new ExactDecimal(1));
  shares[largest] = shares[largest].plus(residual);
  const units = displayUnits(segments, total);
  return segments.map((draft, index) => ({
    key: draft.key,
    kind: draft.kind,
    label: draft.label,
    amount: canonicalDecimal(draft.amount),
    share: canonicalDecimal(shares[index]),
    displayShare: units[index].div(UNITS).toFixed(3),
  }));
}

export function cashDraft(cash: CompositionCash, labels: Pick<CompositionLabels, "cash">): Draft {
  return { key: "cash", kind: "cash", label: labels.cash, amount: sumCash(cash) };
}

/** One segment per Security (merged across Depots); more than `limit` → top `limit` plus "Sonstige"; cash last. */
export function compositionByPosition(
  holdings: readonly CompositionHolding[],
  cash: CompositionCash,
  labels: CompositionLabels,
  limit: number = COMPOSITION_POSITION_LIMIT,
): CompositionSegment[] {
  const items = ordered(group(holdings, (h) => `security:${h.securityId}`, (h) => h.securityName));
  const drafts = items.slice(0, limit);
  if (items.length > limit) {
    const rest = items.slice(limit).reduce((sum, item) => sum.plus(item.amount), new ExactDecimal(0));
    drafts.push({ key: "other", kind: "other", label: labels.other, amount: rest });
  }
  return finalize([...drafts, cashDraft(cash, labels)]);
}

/** One segment per asset type; cash last. */
export function compositionByAssetType(
  holdings: readonly CompositionHolding[],
  cash: CompositionCash,
  labels: CompositionLabels,
): CompositionSegment[] {
  const items = ordered(group(holdings, (h) => `type:${h.assetType}`, (h) => labels.assetType(h.assetType)));
  return finalize([...items, cashDraft(cash, labels)]);
}

/** One segment per Depot (its Positions value); all cash in its own segment, last. */
export function compositionByDepot(
  holdings: readonly CompositionHolding[],
  cash: CompositionCash,
  labels: CompositionLabels,
): CompositionSegment[] {
  const items = ordered(group(holdings, (h) => `depot:${h.depotId}`, (h) => h.depotName));
  return finalize([...items, cashDraft(cash, labels)]);
}

/**
 * Share of each holding value in its scope: `value / (Σ non-null values + Σ cash)`, rounded half-up to 30
 * decimal places. `null` for a holding without a value (unpriced) and for every holding when that total
 * is not positive. Same order as `values`.
 */
export function holdingShares(values: readonly (string | null)[], cash: CompositionCash): (string | null)[] {
  const total = values.reduce<Decimal>((sum, value) => (value === null ? sum : sum.plus(value)), sumCash(cash));
  if (total.lte(0)) return values.map(() => null);
  return values.map((value) =>
    value === null ? null : canonicalDecimal(new ExactDecimal(value).div(total).toDecimalPlaces(SHARE_DECIMALS, ExactDecimal.ROUND_HALF_UP)),
  );
}

/** Σ of the non-null holding values (unpriced holdings count 0) and Σ of the cash balances, as decimal strings. */
export function holdingTotals(values: readonly (string | null)[], cash: CompositionCash): { positionsValue: string; cash: string } {
  const positionsValue = values.reduce<Decimal>((sum, value) => (value === null ? sum : sum.plus(value)), new ExactDecimal(0));
  return { positionsValue: canonicalDecimal(positionsValue), cash: canonicalDecimal(sumCash(cash)) };
}
