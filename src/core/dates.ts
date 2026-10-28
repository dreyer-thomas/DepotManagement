/**
 * Business dates: `YYYY-MM-DD` in Europe/Berlin, never timestamps. Pure: "now" is passed in.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** True for a real calendar date in `YYYY-MM-DD` form (e.g. not `2026-02-30`). */
export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const BERLIN_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Europe/Berlin business date of an instant, e.g. 2026-10-25T23:30Z → `2026-10-26`. */
export function businessDate(instant: Date): string {
  const parts = Object.fromEntries(BERLIN_DATE.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Days since 1970-01-01 of a proleptic Gregorian date (Hinnant's `days_from_civil`). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date `days` days after 1970-01-01 as `YYYY-MM-DD` (Hinnant's `civil_from_days`). */
function civilFromDays(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The business date `days` calendar days after `date` (negative: before), e.g. `2026-10-31` + 1 → `2026-11-01`. */
export function addDays(date: string, days: number): string {
  const match = ISO_DATE.exec(date);
  if (!match || !isBusinessDate(date)) throw new RangeError(`Not a business date: ${date}`);
  return civilFromDays(daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3])) + days);
}

/**
 * The business date `months` calendar months after `date` (negative: before), the day clamped to the
 * target month's end, e.g. `2026-03-31` − 1 → `2026-02-28`, `2024-02-29` − 12 → `2023-02-28`.
 */
export function addMonths(date: string, months: number): string {
  const match = ISO_DATE.exec(date);
  if (!match || !isBusinessDate(date)) throw new RangeError(`Not a business date: ${date}`);
  if (!Number.isInteger(months)) throw new RangeError(`Not a whole number of months: ${months}`);
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const day = Math.min(Number(match[3]), daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Calendar days from `from` to `to` (negative when `to` is earlier), e.g. `2021-01-01` → `2022-01-01` = 365. */
export function daysBetween(from: string, to: string): number {
  const a = ISO_DATE.exec(from);
  const b = ISO_DATE.exec(to);
  if (!a || !isBusinessDate(from)) throw new RangeError(`Not a business date: ${from}`);
  if (!b || !isBusinessDate(to)) throw new RangeError(`Not a business date: ${to}`);
  return (
    daysFromCivil(Number(b[1]), Number(b[2]), Number(b[3])) - daysFromCivil(Number(a[1]), Number(a[2]), Number(a[3]))
  );
}

/**
 * The last point of each calendar month (`YYYY-MM` of `date`) of `points` sorted ascending by date, in
 * that order: a daily series sampled to month ends (the last month may end before its last day).
 */
export function lastPerMonth<T extends { date: string }>(points: readonly T[]): T[] {
  return points.filter((point, index) => index === points.length - 1 || points[index + 1].date.slice(0, 7) !== point.date.slice(0, 7));
}
