/**
 * ZigZag pivots and Fibonacci levels (story 11.5): significant highs and lows of trading-day closes and
 * the retracement / extension levels of the last completed swing. Pure: imports only core files and
 * `decimal.js`, no clock. It never counts or labels waves — reading the swings stays with the user.
 */
import { canonicalDecimal, ExactDecimal } from "./decimal";
import type { DatedClose } from "./key-figures";

/** Selectable reversal thresholds in percent. */
export const ZIGZAG_THRESHOLDS = ["5", "8", "12"] as const;
export type ZigzagThreshold = (typeof ZIGZAG_THRESHOLDS)[number];
export const DEFAULT_ZIGZAG_THRESHOLD: ZigzagThreshold = "8";

/** A confirmed significant high or low close. */
export type ZigzagPivot = { date: string; price: string; kind: "high" | "low" };

/** A Fibonacci level of the last completed swing; `price` is a canonical decimal string. */
export type FibonacciLevel = { ratio: "0.382" | "0.5" | "0.618" | "1.618"; price: string };

/**
 * Pivots in date order (alternating high/low) and the levels of the last completed swing A→B (the last
 * two pivots): retracements `B − r·(B − A)` and the extension `A + 1.618·(B − A)` (`null` when ≤ 0).
 * Fewer than two pivots: no retracements, no extension.
 */
export type ZigzagResult = { pivots: ZigzagPivot[]; retracements: FibonacciLevel[]; extension: FibonacciLevel | null };

const RETRACEMENT_RATIOS = ["0.382", "0.5", "0.618"] as const;
const EXTENSION_RATIO = "1.618" as const;
/** Decimal places of a level, as the moving averages. */
const LEVEL_DECIMALS = 10;

function level(value: InstanceType<typeof ExactDecimal>): string {
  return canonicalDecimal(value.toDecimalPlaces(LEVEL_DECIMALS, ExactDecimal.ROUND_HALF_UP));
}

/**
 * ZigZag pivots of `closes` (ascending by date, as `tradingDayCloses` returns them) at `thresholdPercent`:
 * a running high H is confirmed as a pivot when a close p falls to `(H − p) ÷ H ≥ t`, a running low L when
 * a close rises to `(p − L) ÷ L ≥ t`. Before the first pivot both extremes are tracked; afterwards only the
 * one opposite to the last pivot, so pivots alternate. On equal closes the earlier date stays the extreme.
 * The running extreme after the last confirmed pivot is not a pivot.
 */
export function zigzag(closes: readonly DatedClose[], thresholdPercent: ZigzagThreshold): ZigzagResult {
  const t = new ExactDecimal(thresholdPercent).dividedBy(100);
  const pivots: ZigzagPivot[] = [];
  const fallsEnough = (high: DatedClose, price: InstanceType<typeof ExactDecimal>) =>
    new ExactDecimal(high.price).minus(price).gte(t.times(high.price));
  const risesEnough = (low: DatedClose, price: InstanceType<typeof ExactDecimal>) =>
    price.minus(low.price).gte(t.times(low.price));
  const confirm = (close: DatedClose, kind: ZigzagPivot["kind"]) =>
    pivots.push({ date: close.date, price: canonicalDecimal(close.price), kind });

  let high: DatedClose | null = null;
  let low: DatedClose | null = null;
  // "up": looking for the next high (last pivot was a low); "down": the next low; null: no pivot yet.
  let direction: "up" | "down" | null = null;
  for (const close of closes) {
    const price = new ExactDecimal(close.price);
    if (direction === null) {
      if (high === null || low === null) {
        high = close;
        low = close;
        continue;
      }
      if (risesEnough(low, price)) {
        confirm(low, "low");
        direction = "up";
        high = close;
      } else if (fallsEnough(high, price)) {
        confirm(high, "high");
        direction = "down";
        low = close;
      } else {
        if (price.gt(high.price)) high = close;
        if (price.lt(low.price)) low = close;
      }
    } else if (direction === "up") {
      if (price.gt(high!.price)) high = close;
      else if (fallsEnough(high!, price)) {
        confirm(high!, "high");
        direction = "down";
        low = close;
      }
    } else {
      if (price.lt(low!.price)) low = close;
      else if (risesEnough(low!, price)) {
        confirm(low!, "low");
        direction = "up";
        high = close;
      }
    }
  }

  if (pivots.length < 2) return { pivots, retracements: [], extension: null };
  const a = new ExactDecimal(pivots[pivots.length - 2].price);
  const b = new ExactDecimal(pivots[pivots.length - 1].price);
  const move = b.minus(a);
  const retracements = RETRACEMENT_RATIOS.map((ratio) => ({ ratio, price: level(b.minus(move.times(ratio))) }));
  const extensionValue = a.plus(move.times(EXTENSION_RATIO));
  const extension = extensionValue.gt(0) ? { ratio: EXTENSION_RATIO, price: level(extensionValue) } : null;
  return { pivots, retracements, extension };
}
