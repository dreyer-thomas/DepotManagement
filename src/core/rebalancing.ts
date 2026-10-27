/**
 * Target allocation and rebalancing (story 8.5). Pure, decimal strings only; "today" is passed in. Every
 * holding and cash balance is mapped to one of ten segments (funds via their region split, story 8.4);
 * the scope's actual mix is compared with the stored targets, and an advisory proposal is built: a new
 * deposit goes to the largest deficits first, segments outside the threshold trade back to their target,
 * sells take the lowest-tax FIFO lots first, and each sale's gain and tax come from `fifo` and `taxPreview`
 * (AD-21: the one tax function). Nothing here is booked or stored.
 */
import type { CorporateActions } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { parseDecimalInput } from "./decimal-input";
import { fifo } from "./fifo";
import type { GainsRow } from "./gains-analysis";
import { distributeByRegion, type RegionWeights, type SplitRegion } from "./region-split";
import { type TaxAllowanceInput, type TaxSecurity, taxPreview } from "./tax";

type Decimal = InstanceType<typeof ExactDecimal>;

/** The target segments in display order. */
export const SEGMENTS = [
  "equityUsa",
  "equityEurope",
  "equityJapan",
  "equityPacificExJapan",
  "equityEmerging",
  "bonds",
  "commodities",
  "realEstate",
  "crypto",
  "cash",
] as const;
export type Segment = (typeof SEGMENTS)[number];

/** Scope value of the whole Portfolio's targets; any other target scope is a Depot id. */
export const PORTFOLIO_SCOPE = "portfolio";

/** Default deviation threshold in percentage points. */
export const DEFAULT_THRESHOLD = "2";

const HUNDRED = new ExactDecimal(100);
/** Decimals of the reported share and deviation (the in-range check uses the exact values). */
const DISPLAY_DECIMALS = 10;
const ZERO = new ExactDecimal(0);

const round2 = (value: Decimal) => value.toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);
const sum = (values: readonly (string | Decimal)[]) => values.reduce<Decimal>((total, value) => total.plus(value), ZERO);

// ---- Segment mapping ----

/** The effective classification values the mapping reads (manual wins; read via the classification module). */
export type SegmentClassification = { type: string; assetClass: string | null; region: string | null; country: string | null };

/** One segment's part of a holding: `segment` null = fits no segment (unassigned); `weight` = fraction of the holding. */
export type SegmentSlice = { segment: Segment | null; value: string; weight: string };

const SPLIT_SEGMENTS: Readonly<Record<SplitRegion, Segment | null>> = {
  USA: "equityUsa",
  Europa: "equityEurope",
  Japan: "equityJapan",
  "Pazifik ohne Japan": "equityPacificExJapan",
  Schwellenländer: "equityEmerging",
  Sonstige: null,
};

const ASSET_CLASS_SEGMENTS: Readonly<Record<string, Segment>> = {
  Krypto: "crypto",
  Geldmarkt: "cash",
  Anleihen: "bonds",
  Rohstoffe: "commodities",
  Immobilien: "realEstate",
};

/** The equity segment of a single region (no split): Asien-Pazifik is Japan only for the country "Japan". */
function equitySegment(region: string | null, country: string | null): Segment | null {
  switch (region) {
    case "USA":
    case "Nordamerika":
      return "equityUsa";
    case "Europa":
      return "equityEurope";
    case "Asien-Pazifik":
      return country === "Japan" ? "equityJapan" : "equityPacificExJapan";
    case "Schwellenländer":
      return "equityEmerging";
    default:
      return null;
  }
}

/**
 * The segments a holding of `value` falls into: type CRYPTO or asset class Krypto → crypto; Geldmarkt →
 * cash; Anleihen → bonds; Rohstoffe → commodities; Immobilien → realEstate; Aktien → distributed by the
 * effective region `split` (Sonstige unassigned) or else by the single region; anything else unassigned.
 * The slices sum exactly to `value`.
 */
export function segmentSlices(value: string, classification: SegmentClassification, split: RegionWeights | null): SegmentSlice[] {
  const whole = (segment: Segment | null): SegmentSlice[] => [{ segment, value: canonicalDecimal(value), weight: "1" }];
  const { type, assetClass } = classification;
  if (type === "CRYPTO") return whole("crypto");
  if (assetClass !== null && Object.hasOwn(ASSET_CLASS_SEGMENTS, assetClass)) return whole(ASSET_CLASS_SEGMENTS[assetClass]);
  if (assetClass !== "Aktien") return whole(null);
  if (split && split.length > 0) {
    return distributeByRegion(value, split).map((slice) => ({ segment: SPLIT_SEGMENTS[slice.region], value: slice.value, weight: slice.weight }));
  }
  return whole(equitySegment(classification.region, classification.country));
}

// ---- Targets ----

export type Targets = Record<Segment, string>;

export type TargetFailureReason = "target-invalid" | "target-sum" | "threshold-invalid";

export type ParseTargetsResult =
  | { ok: true; targets: Targets; threshold: string }
  | { ok: false; reason: TargetFailureReason; segment?: Segment };

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** German or plain decimal text, ≥ 0, ≤ 100, ≤ 2 decimals; empty → `fallback`; null when invalid. */
function percent(raw: unknown, fallback: string): string | null {
  if (isEmpty(raw)) return fallback;
  if (typeof raw !== "string") return null;
  const parsed = parseDecimalInput(raw);
  if (!parsed.ok || parsed.value === "") return null;
  const value = new ExactDecimal(parsed.value);
  if (value.isNegative() || value.gt(HUNDRED) || value.decimalPlaces() > 2) return null;
  return canonicalDecimal(value);
}

/**
 * Validates targets per segment (percent; empty/absent = 0; each ≥ 0, ≤ 100, ≤ 2 decimals; summing to exactly
 * 100) and the threshold in percentage points (empty = 2; ≥ 0, ≤ 100, ≤ 2 decimals). Field errors come
 * first (`target-invalid` with the segment, then `threshold-invalid`), then `target-sum`.
 */
export function parseTargets(targets: Readonly<Partial<Record<Segment, unknown>>>, threshold: unknown): ParseTargetsResult {
  const result = {} as Targets;
  for (const segment of SEGMENTS) {
    const value = percent(targets[segment], "0");
    if (value === null) return { ok: false, reason: "target-invalid", segment };
    result[segment] = value;
  }
  const parsedThreshold = percent(threshold, DEFAULT_THRESHOLD);
  if (parsedThreshold === null) return { ok: false, reason: "threshold-invalid" };
  if (!sum(SEGMENTS.map((segment) => result[segment])).eq(HUNDRED)) return { ok: false, reason: "target-sum" };
  return { ok: true, targets: result, threshold: parsedThreshold };
}

/** Targets as a plain object, non-zero segments only, in `SEGMENTS` order (stored JSON / export record). */
export function targetRecord(targets: Readonly<Targets>): Partial<Record<Segment, string>> {
  const record: Partial<Record<Segment, string>> = {};
  for (const segment of SEGMENTS) if (!new ExactDecimal(targets[segment]).isZero()) record[segment] = targets[segment];
  return record;
}

/**
 * Targets of a stored record: only `SEGMENTS` keys with canonical non-zero percent strings (≤ 100, ≤ 2
 * decimals) summing to exactly 100; anything else gives null.
 */
export function targetsFromRecord(record: unknown): Targets | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
  const entries = Object.entries(record);
  if (entries.some(([key, value]) => !(SEGMENTS as readonly string[]).includes(key) || typeof value !== "string")) return null;
  const parsed = parseTargets(record as Partial<Record<Segment, unknown>>, DEFAULT_THRESHOLD);
  if (!parsed.ok) return null;
  const canonical = entries.every(([key, value]) => parsed.targets[key as Segment] === value && value !== "0");
  return canonical ? parsed.targets : null;
}

/** True for a canonical threshold string (≥ 0, ≤ 100, ≤ 2 decimals). */
export function isThreshold(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  const parsed = parseTargets({ cash: "100" }, value);
  return parsed.ok && parsed.threshold === value;
}

// ---- Deposit ----

/**
 * Distributes `deposit` greedily: the segment with the largest deficit `target% × (A + D) − actual` first
 * (ties in segment order), each up to its deficit, until the deposit is used (A = Σ actual). Exact decimals;
 * every segment present ("0" when it gets nothing).
 */
export function distributeDeposit(actual: Readonly<Record<Segment, string>>, targets: Readonly<Targets>, deposit: string): Record<Segment, string> {
  const base = sum(SEGMENTS.map((segment) => actual[segment])).plus(deposit);
  const deficits = SEGMENTS.map((segment, index) => ({
    segment,
    index,
    deficit: new ExactDecimal(targets[segment]).div(HUNDRED).times(base).minus(actual[segment]),
  }));
  deficits.sort((a, b) => b.deficit.comparedTo(a.deficit) || a.index - b.index);
  const shares = Object.fromEntries(SEGMENTS.map((segment) => [segment, "0"])) as Record<Segment, string>;
  let rest = new ExactDecimal(deposit);
  for (const { segment, deficit } of deficits) {
    if (!rest.gt(0) || !deficit.gt(0)) break;
    const share = ExactDecimal.min(rest, deficit);
    shares[segment] = canonicalDecimal(share);
    rest = rest.minus(share);
  }
  return shares;
}

// ---- Rebalancing ----

/** A priced Position of one Depot in scope. */
export type RebalancingHolding = {
  securityId: string;
  depotId: string;
  quantity: string;
  price: string;
  /** quantity × price, as on the Aufteilung tab. */
  value: string;
  classification: SegmentClassification;
  /** The effective region split of a fund, else null. */
  split: RegionWeights | null;
};

/** The Cash Account balance of one Depot in scope. */
export type RebalancingCash = { depotId: string; value: string };

/** The tax input (`taxPreview` without brokers and today), every Depot with its id. */
export type RebalancingTaxInput = {
  depots: readonly { depotId: string; broker: string; rows: readonly GainsRow[] }[];
  actions: CorporateActions;
  securities: Readonly<Record<string, TaxSecurity>>;
  allowances: readonly TaxAllowanceInput[];
};

export type RebalancingInput = {
  holdings: readonly RebalancingHolding[];
  cash: readonly RebalancingCash[];
  /** The scope's stored targets; null = none stored (no proposal). */
  targets: { targets: Targets; threshold: string } | null;
  /** New deposit (≥ 0, ≤ 2 decimals); "0" without one. */
  deposit: string;
  tax: RebalancingTaxInput;
  today: string;
};

export type SegmentRow = {
  segment: Segment;
  /** Actual value in the scope (€). */
  value: string;
  /** value / assignable (fraction, 10 decimals); null when the assignable value is 0. */
  share: string | null;
  /** Target percent; null without targets. */
  target: string | null;
  /** share × 100 − target, in percentage points (10 decimals); null without targets or share. */
  deviationPoints: string | null;
  /** value − target% × assignable (€); null without targets. */
  deviationAmount: string | null;
  /** |deviationPoints| < threshold; null without targets or share, and for an empty segment with target 0. */
  inRange: boolean | null;
};

/** A holding's unassigned part (Sonstige share, Welt fund without split, mixed/derivative/unknown). */
export type UnassignedHolding = { securityId: string; depotId: string; value: string };

export type BuyInstrument = { kind: "security"; securityId: string } | { kind: "cash" } | null;

export type RebalancingBuy = { segment: Segment; amount: string; instrument: BuyInstrument };

export type RebalancingSell = {
  segment: Segment;
  kind: "security" | "cash";
  /** null for a cash "sale". */
  securityId: string | null;
  depotId: string;
  /** Units to sell (≤ 6 decimals); null for cash. */
  quantity: string | null;
  amount: string;
  /** Estimated realized gain (FIFO); "0" for cash. */
  gain: string;
  /** Estimated tax (difference of today's year `estimated` for the broker); "0" for cash, negative when a loss lowers it. */
  tax: string;
};

export type RebalancingProposal = {
  deposit: string;
  buys: RebalancingBuy[];
  sells: RebalancingSell[];
  /** Segments within the threshold after the deposit (excluding empty segments without a target). */
  inRange: Segment[];
  totalBuys: string;
  totalSells: string;
  totalTax: string;
  /** deposit + totalSells − totalBuys. */
  cashLeft: string;
};

export type RebalancingResult = {
  /** Scope value: Σ holdings + Σ cash. */
  total: string;
  /** total − unassigned. */
  assignable: string;
  unassigned: { value: string; holdings: UnassignedHolding[] };
  segments: SegmentRow[];
  proposal: RebalancingProposal | null;
};

/** One segment slice of a holding or cash balance (a sell candidate / buy instrument). */
type Slice = { segment: Segment; value: Decimal; holding: RebalancingHolding | null; cash: RebalancingCash | null };

/** Remaining FIFO lots of a holding (shared across segments): units and cost per unit. */
type LotState = { price: Decimal; lots: { quantity: Decimal; unitCost: Decimal }[]; remaining: Decimal; teilfreistellung: Decimal };

const holdingKey = (depotId: string, securityId: string) => JSON.stringify([depotId, securityId]);

/** The open lots of every holding in FIFO order, up to the holding quantity; units beyond the lots cost 0. */
function lotStates(holdings: readonly RebalancingHolding[], tax: RebalancingTaxInput, today: string): Map<string, LotState> {
  const states = new Map<string, LotState>();
  const fifoByDepot = new Map<string, ReturnType<typeof fifo>>();
  for (const holding of holdings) {
    let results = fifoByDepot.get(holding.depotId);
    if (!results) {
      const rows = tax.depots.find((depot) => depot.depotId === holding.depotId)?.rows ?? [];
      fifoByDepot.set(holding.depotId, (results = fifo(rows, today, tax.actions)));
    }
    const quantity = new ExactDecimal(holding.quantity);
    let left = quantity;
    const lots: LotState["lots"] = [];
    for (const lot of results.find((result) => result.securityId === holding.securityId)?.lots ?? []) {
      if (!left.gt(0)) break;
      const lotQuantity = new ExactDecimal(lot.quantity);
      if (!lotQuantity.gt(0)) continue;
      const taken = ExactDecimal.min(lotQuantity, left);
      lots.push({ quantity: taken, unitCost: new ExactDecimal(lot.costBasis).div(lotQuantity) });
      left = left.minus(taken);
    }
    if (left.gt(0)) lots.push({ quantity: left, unitCost: ZERO });
    const security = tax.securities[holding.securityId];
    states.set(holdingKey(holding.depotId, holding.securityId), {
      price: new ExactDecimal(holding.price),
      lots,
      remaining: quantity,
      teilfreistellung: new ExactDecimal(security?.category === "fund" ? security.teilfreistellung : "0"),
    });
  }
  return states;
}

/** Taxable gain ratio of selling from a lot: (price − unit cost) / price × (1 − Teilfreistellung). */
function lotRatio(state: LotState): Decimal | null {
  const lot = state.lots[0];
  if (!lot || !state.price.gt(0)) return null;
  return state.price.minus(lot.unitCost).div(state.price).times(new ExactDecimal(1).minus(state.teilfreistellung));
}

/** A segment's sale pieces per candidate, in first-take order, with exact amounts. */
type Piece = { slice: Slice; amount: Decimal };

/**
 * Takes `need` from the segment's candidates: repeatedly the candidate whose next lot has the lowest taxable
 * gain ratio (cash at 0; ties in candidate order), up to the remaining need, the slice and the lot.
 */
function takeSells(candidates: readonly Slice[], need: Decimal, states: Map<string, LotState>): Piece[] {
  const caps = candidates.map((slice) => slice.value);
  const pieces = new Map<number, Piece>();
  let rest = need;
  while (rest.gt(0)) {
    let best = -1;
    let bestRatio: Decimal | null = null;
    candidates.forEach((slice, index) => {
      if (!caps[index].gt(0)) return;
      const ratio = slice.holding ? lotRatio(states.get(holdingKey(slice.holding.depotId, slice.holding.securityId)) as LotState) : ZERO;
      if (ratio === null) return;
      if (bestRatio === null || ratio.lt(bestRatio)) {
        best = index;
        bestRatio = ratio;
      }
    });
    if (best < 0) break;
    const slice = candidates[best];
    let take = ExactDecimal.min(rest, caps[best]);
    if (slice.holding) {
      const state = states.get(holdingKey(slice.holding.depotId, slice.holding.securityId)) as LotState;
      const lot = state.lots[0];
      take = ExactDecimal.min(take, lot.quantity.times(state.price));
      const units = take.div(state.price);
      if (units.gte(lot.quantity)) state.lots.shift();
      else lot.quantity = lot.quantity.minus(units);
    }
    caps[best] = caps[best].minus(take);
    rest = rest.minus(take);
    const piece = pieces.get(best);
    if (piece) piece.amount = piece.amount.plus(take);
    else pieces.set(best, { slice, amount: take });
  }
  return [...pieces.values()];
}

/** Estimated gain and tax of each Security sale, applied cumulatively in proposal order. */
function estimateTaxes(sells: RebalancingSell[], tax: RebalancingTaxInput, today: string): void {
  const rows = new Map(tax.depots.map((depot) => [depot.depotId, [...depot.rows]]));
  const brokerOf = new Map(tax.depots.map((depot) => [depot.depotId, depot.broker]));
  const nextSequence = new Map(tax.depots.map((depot) => [depot.depotId, depot.rows.reduce((max, row) => Math.max(max, row.sequence), 0) + 1]));
  const estimated = new Map<string, Decimal>();
  const estimate = (broker: string) => {
    const years = taxPreview({
      depots: tax.depots.filter((depot) => depot.broker === broker).map((depot) => ({ broker, rows: rows.get(depot.depotId) ?? [] })),
      actions: tax.actions,
      securities: tax.securities,
      allowances: tax.allowances,
      brokers: [broker],
      today,
    });
    return new ExactDecimal(years[0]?.brokers[0]?.estimated ?? "0");
  };
  for (const sell of sells) {
    if (sell.kind !== "security" || sell.securityId === null || sell.quantity === null) continue;
    const depotRows = rows.get(sell.depotId);
    const broker = brokerOf.get(sell.depotId);
    if (!depotRows || broker === undefined) continue;
    const before = estimated.get(broker) ?? estimate(broker);
    const sequence = nextSequence.get(sell.depotId) as number;
    nextSequence.set(sell.depotId, sequence + 1);
    depotRows.push({ securityId: sell.securityId, type: "SELL", date: today, sequence, quantity: sell.quantity, amount: sell.amount, fee: "0", tax: "0" });
    const sale = fifo(depotRows, today, tax.actions)
      .flatMap((result) => result.sales)
      .find((entry) => entry.date === today && entry.sequence === sequence);
    const after = estimate(broker);
    estimated.set(broker, after);
    sell.gain = sale ? sale.gain : "0";
    sell.tax = canonicalDecimal(after.minus(before));
  }
}

/** The largest holding of a segment (aggregated per Security, cash balances together), or null. */
function buyInstrument(slices: readonly Slice[]): BuyInstrument {
  const totals = new Map<string, { instrument: Exclude<BuyInstrument, null>; value: Decimal }>();
  for (const slice of slices) {
    const key = slice.holding ? `s:${slice.holding.securityId}` : "cash";
    const entry = totals.get(key);
    if (entry) entry.value = entry.value.plus(slice.value);
    else
      totals.set(key, {
        instrument: slice.holding ? { kind: "security", securityId: slice.holding.securityId } : { kind: "cash" },
        value: slice.value,
      });
  }
  let best: { instrument: Exclude<BuyInstrument, null>; value: Decimal } | null = null;
  for (const entry of totals.values()) if (entry.value.gt(0) && (best === null || entry.value.gt(best.value))) best = entry;
  return best?.instrument ?? null;
}

/**
 * The scope's segment table and, with targets, the rebalancing proposal. Segment values plus unassigned
 * equal the scope value; shares, targets and trades refer to the assignable value A. A deposit D goes to the
 * largest deficits first; a segment whose deviation after the deposit is below the threshold keeps only its
 * deposit share, every other segment trades to exactly `target% × (A + D)` (cents, half-up). Buys name the
 * segment's largest holding; sells take the lowest taxable gain ratio first and carry their estimated gain
 * and tax (see `estimateTaxes`).
 */
export function rebalancing(input: RebalancingInput): RebalancingResult {
  const slices: Slice[] = [];
  const unassignedHoldings: UnassignedHolding[] = [];
  for (const holding of input.holdings) {
    for (const slice of segmentSlices(holding.value, holding.classification, holding.split)) {
      if (slice.segment === null) {
        const existing = unassignedHoldings.find((entry) => entry.securityId === holding.securityId && entry.depotId === holding.depotId);
        if (existing) existing.value = canonicalDecimal(new ExactDecimal(existing.value).plus(slice.value));
        else unassignedHoldings.push({ securityId: holding.securityId, depotId: holding.depotId, value: slice.value });
      } else {
        slices.push({ segment: slice.segment, value: new ExactDecimal(slice.value), holding, cash: null });
      }
    }
  }
  for (const cash of input.cash) slices.push({ segment: "cash", value: new ExactDecimal(cash.value), holding: null, cash });

  const actual = Object.fromEntries(
    SEGMENTS.map((segment) => [segment, canonicalDecimal(sum(slices.filter((slice) => slice.segment === segment).map((slice) => slice.value)))]),
  ) as Record<Segment, string>;
  const unassigned = sum(unassignedHoldings.map((entry) => entry.value));
  const assignable = sum(SEGMENTS.map((segment) => actual[segment]));
  const total = assignable.plus(unassigned);
  const targets = input.targets;
  const threshold = new ExactDecimal(targets?.threshold ?? DEFAULT_THRESHOLD);

  const segments: SegmentRow[] = SEGMENTS.map((segment) => {
    const value = new ExactDecimal(actual[segment]);
    const share = assignable.isZero() ? null : value.div(assignable);
    const target = targets ? targets.targets[segment] : null;
    const deviation = target !== null && share !== null ? share.times(HUNDRED).minus(target) : null;
    return {
      segment,
      value: actual[segment],
      share: share === null ? null : canonicalDecimal(share.toDecimalPlaces(DISPLAY_DECIMALS, ExactDecimal.ROUND_HALF_UP)),
      target,
      deviationPoints: deviation === null ? null : canonicalDecimal(deviation.toDecimalPlaces(DISPLAY_DECIMALS, ExactDecimal.ROUND_HALF_UP)),
      deviationAmount: target === null ? null : canonicalDecimal(value.minus(new ExactDecimal(target).div(HUNDRED).times(assignable))),
      // An empty segment without a target is not "im Rahmen" (nothing to compare).
      inRange: deviation === null || (value.isZero() && new ExactDecimal(target as string).isZero()) ? null : deviation.abs().lt(threshold),
    };
  });

  const result: RebalancingResult = {
    total: canonicalDecimal(total),
    assignable: canonicalDecimal(assignable),
    unassigned: { value: canonicalDecimal(unassigned), holdings: unassignedHoldings },
    segments,
    proposal: null,
  };
  if (!targets) return result;

  const deposit = new ExactDecimal(input.deposit);
  const base = assignable.plus(deposit);
  const shares = distributeDeposit(actual, targets.targets, canonicalDecimal(deposit));
  const buys: RebalancingBuy[] = [];
  const sells: RebalancingSell[] = [];
  const inRange: Segment[] = [];
  const states = lotStates(input.holdings, input.tax, input.today);

  for (const segment of SEGMENTS) {
    if (!base.gt(0)) break;
    const value = new ExactDecimal(actual[segment]);
    const share = new ExactDecimal(shares[segment]);
    const target = new ExactDecimal(targets.targets[segment]);
    const deviation = value.plus(share).div(base).times(HUNDRED).minus(target);
    const segmentSlicesOf = slices.filter((slice) => slice.segment === segment);
    let trade: Decimal;
    if (deviation.abs().lt(threshold)) {
      if (!(target.isZero() && value.plus(share).isZero())) inRange.push(segment);
      trade = round2(share);
    } else {
      trade = round2(target.div(HUNDRED).times(base).minus(value));
    }
    if (trade.gt(0)) {
      buys.push({ segment, amount: canonicalDecimal(trade), instrument: buyInstrument(segmentSlicesOf) ?? (segment === "cash" ? { kind: "cash" } : null) });
    } else if (trade.lt(0)) {
      const candidates = segmentSlicesOf.filter((slice) => slice.value.gt(0));
      // Cumulative rounding keeps the segment's sale amounts summing to the rounded trade.
      let taken = ZERO;
      let rounded = ZERO;
      for (const piece of takeSells(candidates, trade.negated(), states)) {
        taken = taken.plus(piece.amount);
        const amount = round2(taken).minus(rounded);
        rounded = round2(taken);
        if (amount.isZero()) continue;
        const { holding, cash } = piece.slice;
        if (holding) {
          const state = states.get(holdingKey(holding.depotId, holding.securityId)) as LotState;
          const quantity = ExactDecimal.min(amount.div(state.price).toDecimalPlaces(6, ExactDecimal.ROUND_HALF_UP), state.remaining);
          // Too small for one millionth of a unit: no sale (it would book its whole amount as gain).
          if (quantity.isZero()) continue;
          state.remaining = state.remaining.minus(quantity);
          sells.push({
            segment,
            kind: "security",
            securityId: holding.securityId,
            depotId: holding.depotId,
            quantity: canonicalDecimal(quantity),
            amount: canonicalDecimal(amount),
            gain: "0",
            tax: "0",
          });
        } else if (cash) {
          sells.push({ segment, kind: "cash", securityId: null, depotId: cash.depotId, quantity: null, amount: canonicalDecimal(amount), gain: "0", tax: "0" });
        }
      }
    }
  }
  estimateTaxes(sells, input.tax, input.today);

  const totalBuys = sum(buys.map((buy) => buy.amount));
  const totalSells = sum(sells.map((sell) => sell.amount));
  result.proposal = {
    deposit: canonicalDecimal(deposit),
    buys,
    sells,
    inRange,
    totalBuys: canonicalDecimal(totalBuys),
    totalSells: canonicalDecimal(totalSells),
    totalTax: canonicalDecimal(sum(sells.map((sell) => sell.tax))),
    cashLeft: canonicalDecimal(deposit.plus(totalSells).minus(totalBuys)),
  };
  return result;
}
