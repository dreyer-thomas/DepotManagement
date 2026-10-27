/**
 * Drawdown (FR-22): how far a daily level series fell below its running peak. The level is the TTWROR
 * index for a Portfolio or Depot (`ttwrorIndex`, so flows never count as losses) and the split-adjusted
 * resolver price for a Security (`securityPriceSeries`, so a split is never a drop). Pure; ratios are
 * decimal strings (`ratioString`), ≤ 0.
 */
import { daysBetween } from "./dates";
import { ratioString, ReturnDecimal, type ReturnValue } from "./returns";

/** One day of a level series; `null` = no level yet (e.g. no price). */
export type DrawdownLevel = { date: string; level: string | null };

/** One day's drawdown `level / runningPeak − 1`; `null` without a level. */
export type DrawdownPoint = { date: string; drawdown: string | null };

/** The phase of the maximum drawdown: peak before the trough → recovery (or the last date). */
export type DrawdownPhase = {
  /** Latest date the level reached the peak before the trough. */
  peak: string;
  /** First later date the level is back at that peak (`recovered`), else the last point's date. */
  end: string;
  recovered: boolean;
  /** Calendar days `peak → end`. */
  days: number;
};

export type Drawdown = {
  points: DrawdownPoint[];
  /** Drawdown of the last point with a level; `null` without any level. */
  current: string | null;
  /** The most negative drawdown (`"0"` without a decline); `null` without any level. */
  max: string | null;
  /** `null` without a decline. */
  phase: DrawdownPhase | null;
};

/**
 * Drawdown of `levels` (one per day, in date order). The running peak starts with `base` (e.g. index `1`
 * the day before the Period) or, without one, with the first level; a level `≥` the peak becomes the new
 * peak (so its date is the latest date at that height). `max` is the earliest of the most negative
 * drawdowns; its phase runs from the peak before it to the first later date with a level `≥` that peak.
 */
export function drawdown(levels: readonly DrawdownLevel[], base?: { date: string; level: string }): Drawdown {
  let peak: { date: string; level: ReturnValue } | null = base ? { date: base.date, level: new ReturnDecimal(base.level) } : null;
  const points: DrawdownPoint[] = [];
  let current: ReturnValue | null = null;
  let trough: { value: ReturnValue; index: number; peak: { date: string; level: ReturnValue } } | null = null;
  for (const [index, point] of levels.entries()) {
    if (point.level === null) {
      points.push({ date: point.date, drawdown: null });
      continue;
    }
    const level = new ReturnDecimal(point.level);
    if (peak === null || level.greaterThanOrEqualTo(peak.level)) peak = { date: point.date, level };
    const value = peak.level.isZero() ? new ReturnDecimal(0) : level.dividedBy(peak.level).minus(1);
    points.push({ date: point.date, drawdown: ratioString(value) });
    current = value;
    if (trough === null || value.lessThan(trough.value)) trough = { value, index, peak };
  }

  const max = trough === null ? null : ratioString(trough.value);
  let phase: DrawdownPhase | null = null;
  // A decline below the ratio precision shows as "0" and has no phase.
  if (trough !== null && max !== "0") {
    const { index: troughIndex, peak: troughPeak } = trough;
    const recovery = levels.find(
      (point, index) =>
        index > troughIndex && point.level !== null && new ReturnDecimal(point.level).greaterThanOrEqualTo(troughPeak.level),
    );
    const end = recovery ? recovery.date : levels[levels.length - 1].date;
    phase = { peak: troughPeak.date, end, recovered: recovery !== undefined, days: daysBetween(troughPeak.date, end) };
  }
  return {
    points,
    current: current === null ? null : ratioString(current),
    max,
    phase,
  };
}
