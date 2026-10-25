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
