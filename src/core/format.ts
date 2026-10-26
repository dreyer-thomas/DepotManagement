/**
 * de-DE presentation helpers. Pure: decimal strings in, display strings out.
 * Values are never converted to JS numbers; rounding is half-up via decimal.js.
 */
import Decimal from "decimal.js";
import { isBusinessDate } from "./dates";

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

/** Business date `YYYY-MM-DD` → `DD.MM.YYYY`. Throws `TypeError` on malformed or impossible dates. */
export function formatDate(isoDate: string): string {
  if (!isBusinessDate(isoDate)) throw new TypeError(`Not a valid YYYY-MM-DD date: ${isoDate}`);
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const BERLIN_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * UTC ISO instant → Europe/Berlin `DD.MM.YYYY, HH:mm`, e.g. `2026-10-23T18:05:00.000Z` →
 * `"23.10.2026, 20:05"`. Throws `TypeError` on an unparsable instant.
 */
export function formatDateTime(isoInstant: string): string {
  // Parsing a given instant reads no clock; only the strict ISO form is accepted.
  const instant = ISO_INSTANT.test(isoInstant) ? Date.parse(isoInstant) : Number.NaN;
  if (Number.isNaN(instant)) throw new TypeError(`Not a valid ISO instant: ${isoInstant}`);
  const parts = Object.fromEntries(BERLIN_DATE_TIME.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
}

const MONTHS_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** Business date `YYYY-MM-DD` → its month heading, e.g. `"Oktober 2026"`. Throws `TypeError` on invalid dates. */
export function formatMonth(isoDate: string): string {
  if (!isBusinessDate(isoDate)) throw new TypeError(`Not a valid YYYY-MM-DD date: ${isoDate}`);
  const [y, m] = isoDate.split("-");
  return `${MONTHS_DE[Number(m) - 1]} ${y}`;
}
