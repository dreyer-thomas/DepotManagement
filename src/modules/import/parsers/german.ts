// German number and date helpers shared by the broker parsers (stories 5.2, 5.4). Amounts go straight
// from text to canonical decimal strings; no JS number ever holds a value.
import { isBusinessDate } from "@/core/dates";
import { parseDecimalInput } from "@/core/decimal-input";

/**
 * A German-formatted amount (`1.234,56`, `-7,90`, `- 7,90`, `2,2450`) as a canonical decimal string
 * (`1234.56`, `-7.9`, `-7.9`, `2.245`); `null` when the text is not a single number.
 */
export function germanAmount(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const result = parseDecimalInput(trimmed);
  return result.ok && result.value !== "" ? result.value : null;
}

const GERMAN_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** A German date `dd.mm.yyyy` as business date `YYYY-MM-DD`; `null` when malformed or not a real day. */
export function germanDate(text: string): string | null {
  const match = GERMAN_DATE.exec(text.trim());
  if (!match) return null;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  return isBusinessDate(date) ? date : null;
}

/** Number token as printed in broker documents: optional sign, digits with `.` grouping and `,` decimals. */
export const AMOUNT_PATTERN = String.raw`-?\s?\d[\d.]*(?:,\d+)?`;

/** Date token `dd.mm.yyyy`. */
export const DATE_PATTERN = String.raw`\d{2}\.\d{2}\.\d{4}`;

/** ISIN-shaped token (check digit not verified). */
export const ISIN_PATTERN = String.raw`[A-Z]{2}[A-Z0-9]{9}\d`;
