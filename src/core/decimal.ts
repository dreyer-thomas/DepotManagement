/**
 * Exact decimal helpers shared by core. Values travel as canonical decimal strings
 * (`new Decimal(x).toFixed()`: no exponent, no rounding, no trailing zeros).
 */
import Decimal from "decimal.js";

/** Decimal constructor with enough precision that sums and products of inputs stay exact. */
export const ExactDecimal = Decimal.clone({ precision: 1000, rounding: Decimal.ROUND_HALF_UP });

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** True for a plain decimal string such as `"12"`, `"-0.5"` or `"1234.50"` (no exponent, no grouping). */
export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_STRING.test(value);
}

/** Canonical form of a decimal: `"1234.50"` → `"1234.5"`, `"-0"` → `"0"`. */
export function canonicalDecimal(value: string | Decimal): string {
  const d = new ExactDecimal(value);
  if (!d.isFinite()) throw new TypeError(`Not a finite decimal: ${String(value)}`);
  return d.isZero() ? "0" : d.toFixed();
}
