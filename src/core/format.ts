/**
 * de-DE presentation helpers. Pure: decimal strings in, display strings out.
 * Values are never converted to JS numbers; rounding is half-up via decimal.js.
 */
import Decimal from "decimal.js";

/** Local Decimal constructor with generous precision for intermediate steps (e.g. ratio × 100). */
const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

const NBSP = " ";
const QUANTITY_MAX_DECIMALS = 8;

export type DecimalInput = string | Decimal;

export interface SignOptions {
  /** Prefix positive values with "+"; zero never gets a sign. */
  sign?: boolean;
}

function toDecimal(value: DecimalInput): Decimal {
  const d = new D(value);
  if (!d.isFinite()) throw new TypeError(`Not a finite decimal: ${String(value)}`);
  return d;
}

function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Rounds half-up to `decimals` places and renders de-DE digits with an explicit sign policy.
 * `trimZeros` drops trailing fraction zeros (and the comma if nothing is left).
 */
function formatDecimal(
  value: Decimal,
  decimals: number,
  { sign = false, trimZeros = false }: { sign?: boolean; trimZeros?: boolean },
): string {
  const fixed = value.abs().toFixed(decimals, Decimal.ROUND_HALF_UP);
  const isZero = new D(fixed).isZero();
  const [integerPart, rawFraction = ""] = fixed.split(".");
  const fraction = trimZeros ? rawFraction.replace(/0+$/, "") : rawFraction;
  const body = groupThousands(integerPart) + (fraction ? `,${fraction}` : "");
  if (isZero) return body;
  if (value.isNegative()) return `-${body}`;
  return sign ? `+${body}` : body;
}

/** `"1234.5"` → `"1.234,50 €"`; with `{ sign: true }` positives get "+". */
export function formatMoney(value: DecimalInput, options: SignOptions = {}): string {
  return `${formatDecimal(toDecimal(value), 2, { sign: options.sign })}${NBSP}€`;
}

/** Takes a ratio: `"0.0321"` → `"+3,21 %"`. Always signed (except zero). */
export function formatPercent(ratio: DecimalInput): string {
  return `${formatDecimal(toDecimal(ratio).times(100), 2, { sign: true })}${NBSP}%`;
}

/** Up to 8 decimals, trailing zeros trimmed: `"10.50000000"` → `"10,5"`, `"1234"` → `"1.234"`. */
export function formatQuantity(value: DecimalInput): string {
  return formatDecimal(toDecimal(value), QUANTITY_MAX_DECIMALS, { trimZeros: true });
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Business date `YYYY-MM-DD` → `DD.MM.YYYY`. Throws `TypeError` on malformed or impossible dates. */
export function formatDate(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match) throw new TypeError(`Not a YYYY-MM-DD date: ${isoDate}`);
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError(`Impossible date: ${isoDate}`);
  }
  return `${d}.${m}.${y}`;
}
