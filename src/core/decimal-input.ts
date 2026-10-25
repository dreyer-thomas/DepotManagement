/**
 * Parses German-style decimal input from form fields into canonical decimal strings.
 * `1.234,56` → `1234.56`, `0,5` → `0.5`, `12.5` → `12.5`, `1.234` → `1234`.
 */
import { canonicalDecimal } from "./decimal";

export type DecimalInputResult = { ok: true; value: string } | { ok: false };

const WITH_COMMA = /^(\d+|[1-9]\d{0,2}(\.\d{3})+),\d+$/;
const THOUSANDS_ONLY = /^[1-9]\d{0,2}(\.\d{3})+$/;
const PLAIN = /^\d+(\.\d+)?$/;

/**
 * Trims and drops spaces; with a comma, dots are thousands separators and the comma is the decimal
 * point; without a comma, `1.234` is thousands-grouped, otherwise one dot is a decimal point.
 * Optional leading `-`. Empty input gives `""` (the field's default applies); anything else is invalid.
 */
export function parseDecimalInput(text: string): DecimalInputResult {
  const compact = text.replace(/\s+/g, "");
  if (compact === "") return { ok: true, value: "" };
  const negative = compact.startsWith("-");
  const body = negative ? compact.slice(1) : compact;
  let plain: string;
  if (body.includes(",")) {
    if (!WITH_COMMA.test(body)) return { ok: false };
    plain = body.replace(/\./g, "").replace(",", ".");
  } else if (THOUSANDS_ONLY.test(body)) {
    plain = body.replace(/\./g, "");
  } else if (PLAIN.test(body)) {
    plain = body;
  } else {
    return { ok: false };
  }
  return { ok: true, value: canonicalDecimal(negative ? `-${plain}` : plain) };
}
