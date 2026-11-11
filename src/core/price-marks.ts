/**
 * Price marks (story 12.2): one stop (fixed EUR price or trailing by a percentage) and one target (EUR price)
 * per Security, each with an optional source and a set date. This file is the single source of truth for
 * their validation and for the state derived on read (effective stop, distances, `breached`); nothing of
 * it is stored. Pure: "today" is passed in; values are canonical decimal strings, ratios `ratioString`s.
 */
import { adjustedPrice, type CorporateActions } from "./corporate-actions";
import { isBusinessDate } from "./dates";
import { parseDecimalInput } from "./decimal-input";
import { canonicalDecimal, ExactDecimal, isDecimalString } from "./decimal";
import { tradingDayCloses } from "./key-figures";
import { type PriceObservation, resolvePrice } from "./prices";
import { ratioString, ReturnDecimal } from "./returns";
import { adjustedObservations, currentSecurityId } from "./security";

/** Longest source text of a mark (trimmed, NFC). */
export const PRICE_MARK_SOURCE_MAX_LENGTH = 200;

/** Bounds of a trailing stop in percent (inclusive; decimals allowed). */
export const TRAILING_STOP_MIN_PERCENT = "1";
export const TRAILING_STOP_MAX_PERCENT = "50";

/** True when `value` (a decimal string) is within the trailing-stop bounds 1..50 %. */
export function isTrailingStopPercent(value: string): boolean {
  const percent = new ExactDecimal(value);
  return percent.greaterThanOrEqualTo(TRAILING_STOP_MIN_PERCENT) && percent.lessThanOrEqualTo(TRAILING_STOP_MAX_PERCENT);
}

export const STOP_TYPES = ["FIXED", "TRAILING"] as const;
export type StopType = (typeof STOP_TYPES)[number];

/** A stop: `FIXED` → `value` is an EUR price; `TRAILING` → `value` is the percentage below the high. */
export type StopMark = { type: StopType; value: string; source: string | null; setDate: string };

/** A target: an EUR price. */
export type TargetMark = { price: string; source: string | null; setDate: string };

/** The marks of one Security as stored (`securityId` is the Security the row belongs to). */
export type PriceMarks = { securityId: string; stop: StopMark | null; target: TargetMark | null };

/** Unvalidated stop input (service, MCP): `value` a plain decimal string; `setDate` absent/empty = today. */
export type StopInput = { type: unknown; value: unknown; source?: unknown; setDate?: unknown };

/** Unvalidated target input: `price` a plain decimal string; `setDate` absent/empty = today. */
export type TargetInput = { price: unknown; source?: unknown; setDate?: unknown };

/** A change of the marks: a field omitted keeps the stored mark, `null` clears it, an object sets it. */
export type PriceMarksPatch = { stop?: StopInput | null; target?: TargetInput | null };

/** A validated patch (same omitted / `null` / set semantics). */
export type ValidPriceMarksPatch = { stop?: StopMark | null; target?: TargetMark | null };

export type PriceMarkField = "stopType" | "stopValue" | "stopSource" | "stopSetDate" | "targetPrice" | "targetSource" | "targetSetDate";

/**
 * Why a field was refused: `required` (empty), `invalid` (not a decimal / unknown type / not a date),
 * `not-positive` (≤ 0), `out-of-range` (trailing percent outside 1..50), `too-long` (source > 200),
 * `future-date` (set date after today).
 */
export type PriceMarkProblem = "required" | "invalid" | "not-positive" | "out-of-range" | "too-long" | "future-date";

export type PriceMarksInvalid = { ok: false; reason: "price-marks-invalid"; field: PriceMarkField; problem: PriceMarkProblem };

export type PriceMarksPatchResult = { ok: true; patch: ValidPriceMarksPatch } | PriceMarksInvalid;

const invalid = (field: PriceMarkField, problem: PriceMarkProblem): PriceMarksInvalid => ({
  ok: false,
  reason: "price-marks-invalid",
  field,
  problem,
});

type Checked<T> = { ok: true; value: T } | PriceMarksInvalid;

function checkSource(value: unknown, field: PriceMarkField): Checked<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return invalid(field, "invalid");
  const source = value.normalize("NFC").trim();
  if (source.length > PRICE_MARK_SOURCE_MAX_LENGTH) return invalid(field, "too-long");
  return { ok: true, value: source === "" ? null : source };
}

function checkSetDate(value: unknown, today: string, field: PriceMarkField): Checked<string> {
  if (value === undefined || value === null || value === "") return { ok: true, value: today };
  if (!isBusinessDate(value)) return invalid(field, "invalid");
  return value > today ? invalid(field, "future-date") : { ok: true, value };
}

function checkPositive(value: unknown, field: PriceMarkField): Checked<string> {
  if (value === undefined || value === null || value === "") return invalid(field, "required");
  if (!isDecimalString(value)) return invalid(field, "invalid");
  const canonical = canonicalDecimal(value);
  return new ExactDecimal(canonical).greaterThan(0) ? { ok: true, value: canonical } : invalid(field, "not-positive");
}

function checkStop(input: StopInput, today: string): Checked<StopMark> {
  if (typeof input !== "object") return invalid("stopType", "invalid");
  const type = input.type;
  if (type !== "FIXED" && type !== "TRAILING") return invalid("stopType", "invalid");
  const value = checkPositive(input.value, "stopValue");
  if (!value.ok) return value;
  if (type === "TRAILING" && !isTrailingStopPercent(value.value)) return invalid("stopValue", "out-of-range");
  const source = checkSource(input.source, "stopSource");
  if (!source.ok) return source;
  const setDate = checkSetDate(input.setDate, today, "stopSetDate");
  if (!setDate.ok) return setDate;
  return { ok: true, value: { type, value: value.value, source: source.value, setDate: setDate.value } };
}

function checkTarget(input: TargetInput, today: string): Checked<TargetMark> {
  if (typeof input !== "object") return invalid("targetPrice", "invalid");
  const price = checkPositive(input.price, "targetPrice");
  if (!price.ok) return price;
  const source = checkSource(input.source, "targetSource");
  if (!source.ok) return source;
  const setDate = checkSetDate(input.setDate, today, "targetSetDate");
  if (!setDate.ok) return setDate;
  return { ok: true, value: { price: price.value, source: source.value, setDate: setDate.value } };
}

/**
 * Validates a patch as of `today`: stop `FIXED` (price > 0) or `TRAILING` (1 ≤ percent ≤ 50), target price
 * > 0; values are plain decimal strings (stored canonical); sources trimmed (NFC), ≤ 200 characters, empty →
 * `null`; set dates `YYYY-MM-DD` ≤ today, absent or empty → today. The first refused field is reported.
 */
export function checkPriceMarksPatch(patch: PriceMarksPatch, today: string): PriceMarksPatchResult {
  const result: ValidPriceMarksPatch = {};
  if (patch.stop !== undefined) {
    if (patch.stop === null) result.stop = null;
    else {
      const stop = checkStop(patch.stop, today);
      if (!stop.ok) return stop;
      result.stop = stop.value;
    }
  }
  if (patch.target !== undefined) {
    if (patch.target === null) result.target = null;
    else {
      const target = checkTarget(patch.target, today);
      if (!target.ok) return target;
      result.target = target.value;
    }
  }
  return { ok: true, patch: result };
}

/** The raw form fields of the marks dialog (German decimals); `stopType` `""` = "Kein Stopp". */
export type PriceMarksForm = {
  stopType: string;
  stopValue: string;
  stopSource: string;
  stopSetDate: string;
  targetPrice: string;
  targetSource: string;
  targetSetDate: string;
};

/** A German decimal field as a plain decimal string; empty stays `""` (→ `required`); unparsable → refused. */
function formDecimal(text: string, field: PriceMarkField): Checked<string> {
  const parsed = parseDecimalInput(text);
  return parsed.ok ? { ok: true, value: parsed.value } : invalid(field, "invalid");
}

/**
 * The full patch of the marks form as of `today`: "Kein Stopp" clears the stop, an empty target price
 * clears the target (its source and date are then ignored); values are parsed as German decimals and the
 * result is validated by `checkPriceMarksPatch`.
 */
export function parsePriceMarksForm(form: PriceMarksForm, today: string): PriceMarksPatchResult {
  let stop: StopInput | null = null;
  if (form.stopType !== "") {
    const value = formDecimal(form.stopValue, "stopValue");
    if (!value.ok) return value;
    stop = { type: form.stopType, value: value.value, source: form.stopSource, setDate: form.stopSetDate };
  }
  let target: TargetInput | null = null;
  if (form.targetPrice.trim() !== "") {
    const price = formDecimal(form.targetPrice, "targetPrice");
    if (!price.ok) return price;
    target = { price: price.value, source: form.targetSource, setDate: form.targetSetDate };
  }
  return checkPriceMarksPatch({ stop, target }, today);
}

/** A non-blocking hint of the form: a fixed stop above or a target below the latest Price. */
export type PriceMarkWarning = "stop-above-price" | "target-below-price";

/**
 * Warnings for marks being entered against the latest Price (today's units): a fixed stop above it, a
 * target below it. Never an error; none without a latest Price. Trailing stops sit below their high by
 * construction and get no warning.
 */
export function priceMarkWarnings(
  marks: { stop?: { type: StopType; value: string } | null; target?: { price: string } | null },
  latest: string | null,
): PriceMarkWarning[] {
  if (latest === null) return [];
  const warnings: PriceMarkWarning[] = [];
  if (marks.stop && marks.stop.type === "FIXED" && new ExactDecimal(marks.stop.value).greaterThan(latest)) warnings.push("stop-above-price");
  if (marks.target && new ExactDecimal(marks.target.price).lessThan(latest)) warnings.push("target-below-price");
  return warnings;
}

/** Which mark the latest Price is beyond (equality counts); `none` without a latest Price. */
export type PriceMarkBreach = "stop" | "target" | "none";

/** The state of a Security's marks as of today, derived on read (never stored). */
export type PriceMarkState = {
  /** Latest resolved Price (units as of today); `null` without any Price. */
  price: string | null;
  priceDate: string | null;
  /** `null` without a stop. */
  stop: {
    /** Fixed: the price in today's units; trailing: high × (1 − p/100); `null` for a trailing stop without any Price. */
    effective: string | null;
    /** Trailing only: the highest Price since the set date (today's units); `null` for a fixed stop or without a Price. */
    high: string | null;
    /** effective ÷ latest − 1; `null` without either. */
    distance: string | null;
  } | null;
  /** `null` without a target. */
  target: {
    /** The target price in today's units. */
    price: string;
    /** target ÷ latest − 1; `null` without a latest Price. */
    distance: string | null;
  } | null;
  breached: PriceMarkBreach;
};

/** `mark ÷ latest − 1`; `null` without either or with a latest Price of zero. */
function distance(mark: string | null, latest: string | null): string | null {
  if (mark === null || latest === null) return null;
  const base = new ReturnDecimal(latest);
  if (base.isZero()) return null;
  return ratioString(new ReturnDecimal(mark).dividedBy(base).minus(1));
}

function maxOf(values: readonly string[]): string | null {
  let high: InstanceType<typeof ExactDecimal> | null = null;
  for (const value of values) {
    const decimal = new ExactDecimal(value);
    if (high === null || decimal.greaterThan(high)) high = decimal;
  }
  return high === null ? null : canonicalDecimal(high);
}

/**
 * The state of `marks` as of `today`. The latest Price is the single resolver's (`resolvePrice`) over the
 * observations carried to today's Securities and units, for the Security `marks.securityId` maps to today
 * (an ISIN change moves the marks to the successor). A fixed stop and the target are carried from their set
 * date to today's units (`adjustedPrice`), so a later split never fires a stop. A trailing stop's high is
 * the maximum of the Price resolved on its set date and every stored trading-day close after the set date
 * and the latest Price — it never falls, and earlier closes never count. `breached`: `stop` when latest ≤
 * effective stop, else `target` when latest ≥ target, else `none`.
 */
export function priceMarkState(
  marks: PriceMarks,
  observations: readonly PriceObservation[],
  actions: CorporateActions,
  today: string,
): PriceMarkState {
  const adjusted = adjustedObservations(observations, actions, today);
  const current = currentSecurityId(marks.securityId, actions, today);
  const latest = resolvePrice(adjusted, current, today);
  const latestPrice = latest?.price ?? null;

  let stop: PriceMarkState["stop"] = null;
  if (marks.stop) {
    let effective: string | null;
    let high: string | null = null;
    if (marks.stop.type === "FIXED") {
      effective = adjustedPrice(marks.securityId, marks.stop.setDate, marks.stop.value, actions, today).price;
    } else {
      const setDate = marks.stop.setDate;
      const base = resolvePrice(adjusted, current, setDate);
      const later = tradingDayCloses(observations, marks.securityId, actions, today)
        .filter((close) => close.date > setDate)
        .map((close) => close.price);
      high = maxOf([...(base ? [base.price] : []), ...later, ...(latestPrice !== null ? [latestPrice] : [])]);
      effective =
        high === null ? null : canonicalDecimal(new ExactDecimal(high).times(new ExactDecimal(1).minus(new ExactDecimal(marks.stop.value).dividedBy(100))));
    }
    stop = { effective, high, distance: distance(effective, latestPrice) };
  }

  let target: PriceMarkState["target"] = null;
  if (marks.target) {
    const price = adjustedPrice(marks.securityId, marks.target.setDate, marks.target.price, actions, today).price;
    target = { price, distance: distance(price, latestPrice) };
  }

  let breached: PriceMarkBreach = "none";
  if (latestPrice !== null) {
    const value = new ExactDecimal(latestPrice);
    if (stop?.effective != null && value.lessThanOrEqualTo(stop.effective)) breached = "stop";
    else if (target && value.greaterThanOrEqualTo(target.price)) breached = "target";
  }

  return { price: latestPrice, priceDate: latest?.date ?? null, stop, target, breached };
}

/**
 * Marks of a predecessor carried to `toSecurityId` (an ISIN change moved them there), for storing them on
 * that Security: fixed stop and target values are converted by the predecessor's own splits and the ISIN
 * change ratios after their set dates (`adjustedPrice` without the successor's splits, which reading the
 * moved row applies itself). A trailing percentage, sources and set dates stay.
 */
export function carryPriceMarks(marks: PriceMarks, toSecurityId: string, actions: CorporateActions, today: string): PriceMarks {
  if (marks.securityId === toSecurityId) return marks;
  const withoutSuccessorSplits: CorporateActions = {
    splits: actions.splits.filter((split) => split.securityId !== toSecurityId),
    isinChanges: actions.isinChanges,
  };
  const carry = (value: string, setDate: string) => adjustedPrice(marks.securityId, setDate, value, withoutSuccessorSplits, today).price;
  return {
    securityId: toSecurityId,
    stop:
      marks.stop === null
        ? null
        : marks.stop.type === "FIXED"
          ? { ...marks.stop, value: carry(marks.stop.value, marks.stop.setDate) }
          : marks.stop,
    target: marks.target === null ? null : { ...marks.target, price: carry(marks.target.price, marks.target.setDate) },
  };
}
