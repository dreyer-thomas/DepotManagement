/**
 * Split adjustment on read (AD-7, AD-8). Pure, decimal strings only. Stored Transactions and Prices
 * are never modified; every quantity/price consumer in core adjusts through this file.
 *
 * A split `old:new` dated D applies before every Transaction dated D: a row dated `d` is adjusted by
 * a split of its Security iff `d < D <= asOf`. Several splits multiply; all `new` and all `old` terms
 * are multiplied first and divided once (`quantity × Πnew / Πold`, `price × Πold / Πnew`).
 */
import { canonicalDecimal, ExactDecimal } from "./decimal";

/** A stock split of one Security; ratio terms are positive integer strings (`old:new`, e.g. `1:4`). */
export type Split = { securityId: string; date: string; ratioOld: string; ratioNew: string };

/** "All splits": the asOf that includes every recorded split (used by holding guards). */
export const ALL_SPLITS = "9999-12-31";

const RATIO_TERM = "([1-9]\\d{0,5})";
const RATIO = new RegExp(`^\\s*${RATIO_TERM}\\s*:\\s*${RATIO_TERM}\\s*$`);

/**
 * Parses ratio text such as `1:4`, `1 : 4` or `10:1` into canonical terms. Both terms are positive
 * integers without leading zeros (at most 6 digits) and differ; anything else is `null`.
 */
export function parseSplitRatio(text: unknown): { ratioOld: string; ratioNew: string } | null {
  if (typeof text !== "string") return null;
  const match = RATIO.exec(text);
  if (!match || match[1] === match[2]) return null;
  return { ratioOld: match[1], ratioNew: match[2] };
}

type Decimal = InstanceType<typeof ExactDecimal>;
type Factor = { num: Decimal; den: Decimal };

/** `Πnew` / `Πold` of the splits that adjust a row of `securityId` dated `date` as of `asOf`; `null` when none. */
function splitFactor(securityId: string, date: string, splits: readonly Split[], asOf: string): Factor | null {
  let num = new ExactDecimal(1);
  let den = new ExactDecimal(1);
  let applies = false;
  for (const split of splits) {
    if (split.securityId !== securityId || !(date < split.date) || split.date > asOf) continue;
    num = num.times(split.ratioNew);
    den = den.times(split.ratioOld);
    applies = true;
  }
  return applies ? { num, den } : null;
}

function scaleQuantity(quantity: string, factor: Factor): string {
  return canonicalDecimal(new ExactDecimal(quantity).times(factor.num).dividedBy(factor.den));
}

function scalePrice(price: string, factor: Factor): string {
  return canonicalDecimal(new ExactDecimal(price).times(factor.den).dividedBy(factor.num));
}

/** A row that may carry a split-adjustable quantity and per-unit price. */
type AdjustableRow = { securityId: string | null; type: string; date: string; quantity: string | null; price?: string | null };

/**
 * Rows with BUY/SELL quantities (× Πnew/Πold) and per-unit prices (× Πold/Πnew, when present)
 * split-adjusted as of `asOf`. Other rows, other fields and unaffected rows are returned unchanged
 * (same object). Amount, fee and tax never change, so Cost Basis and cash are unaffected.
 */
export function adjustTrades<T extends AdjustableRow>(rows: readonly T[], splits: readonly Split[], asOf: string): T[] {
  if (splits.length === 0) return [...rows];
  return rows.map((row) => {
    if (row.securityId === null || (row.type !== "BUY" && row.type !== "SELL")) return row;
    const factor = splitFactor(row.securityId, row.date, splits, asOf);
    if (!factor) return row;
    const adjusted: AdjustableRow = { ...row };
    if (row.quantity !== null) adjusted.quantity = scaleQuantity(row.quantity, factor);
    if (row.price !== undefined && row.price !== null) adjusted.price = scalePrice(row.price, factor);
    return adjusted as T;
  });
}

/** A per-unit price of `securityId` observed on `date`, split-adjusted as of `asOf`. */
export function splitAdjustedPrice(
  securityId: string,
  date: string,
  price: string,
  splits: readonly Split[],
  asOf: string,
): string {
  const factor = splitFactor(securityId, date, splits, asOf);
  return factor ? scalePrice(price, factor) : price;
}

/**
 * A quantity of `securityId` booked on `date`, split-adjusted as of `asOf` (for display); `null` when
 * no split applies.
 */
export function splitAdjustment(
  securityId: string,
  date: string,
  quantity: string,
  splits: readonly Split[],
  asOf: string,
): string | null {
  const factor = splitFactor(securityId, date, splits, asOf);
  return factor ? scaleQuantity(quantity, factor) : null;
}

/*
 * Exact scaled basis. Dividing by `Πold` can give non-terminating decimals (e.g. `3:1` on 10 units),
 * whose rounded sums may miss zero by 1e-999. Holding guards, FIFO and the flat check therefore work
 * on quantities scaled by multiplication only: `scaled = quantity × scale(row)`, where `scale(row)` is
 * the product, over the Security's splits dated `<= asOf`, of `new` when the split is after the row
 * and `old` otherwise. Since `scale(row) = factor(row) × Πold`, a scaled quantity divided by
 * `splitDivisor` (`Πold`) is the split-adjusted quantity as of `asOf`.
 */

/** The exact multiplier of a `securityId` row dated `date` in the scaled basis as of `asOf`. */
export function splitScale(securityId: string, date: string, splits: readonly Split[], asOf: string): Decimal {
  let scale = new ExactDecimal(1);
  for (const split of splits) {
    if (split.securityId !== securityId || split.date > asOf) continue;
    scale = scale.times(date < split.date ? split.ratioNew : split.ratioOld);
  }
  return scale;
}

/** `Πold` of the Security's splits dated `<= asOf`: scaled quantity ÷ divisor = adjusted quantity. */
export function splitDivisor(securityId: string, splits: readonly Split[], asOf: string): Decimal {
  let divisor = new ExactDecimal(1);
  for (const split of splits) {
    if (split.securityId === securityId && split.date <= asOf) divisor = divisor.times(split.ratioOld);
  }
  return divisor;
}

/**
 * BUY/SELL rows with quantities in the exact scaled basis as of `asOf` (see above); other rows and
 * rows of Securities without splits are returned unchanged (same object).
 */
export function scaleTrades<T extends AdjustableRow>(rows: readonly T[], splits: readonly Split[], asOf: string): T[] {
  if (splits.length === 0) return [...rows];
  return rows.map((row) => {
    if (row.securityId === null || row.quantity === null || (row.type !== "BUY" && row.type !== "SELL")) return row;
    const securityId = row.securityId;
    if (!splits.some((split) => split.securityId === securityId && split.date <= asOf)) return row;
    const scaled: AdjustableRow = { ...row, quantity: canonicalDecimal(new ExactDecimal(row.quantity).times(splitScale(securityId, row.date, splits, asOf))) };
    return scaled as T;
  });
}
