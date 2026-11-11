// Price marks over MCP (story 12.5): the `price_marks` payload of `get_security` / `get_watchlist` and the
// input/refusal mapping of `set_price_marks`. Pure renaming of the marks module's `priceMarksView` items
// (`core/price-marks` `priceMarkState`) to snake_case: no comparison or arithmetic here (AD-22, AD-24).
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PRICE_MARK_SOURCE_MAX_LENGTH, TRAILING_STOP_MAX_PERCENT, TRAILING_STOP_MIN_PERCENT } from "@/core/price-marks";
import type { PriceMarkField, PriceMarkProblem, PriceMarksInvalid, PriceMarksPatch, PriceMarksViewItem } from "@/modules/marks";

/** How `price_marks` reads (part of the `get_security`, `get_watchlist` and `set_price_marks` descriptions). */
export const PRICE_MARKS_DESCRIPTION =
  ` price_marks: Tommy's own stop and target price for the Security — his reference levels (e.g. taken from a newspaper or an analyst), not recommendations and not orders — as the app's card "Kursmarken" and its warnings show them; always present, stop and target null when not set.` +
  ` basis "latest close": the marks are checked against the latest close, i.e. price and price_date are the latest resolved price (the daily close or the latest fetch of the day, never intraday moves; EUR, decimal string) of the Security the marks apply to today (the successor after an ISIN change); both null without any price.` +
  ` breached: "stop" when price <= stop.effective, else "target" when price >= target.effective (equality counts), else "none" (also without a price); a breach lasts while the price stays beyond the mark, there is no acknowledgement.` +
  ` stop: null or { type: "FIXED" (price = the EUR stop as set, after an ISIN change converted to the successor by its ratio; percent null) or "TRAILING" (percent = the distance below the high as set, ${TRAILING_STOP_MIN_PERCENT}..${TRAILING_STOP_MAX_PERCENT}, price null), effective (the stop in today's units: FIXED = price adjusted for splits since set_date; TRAILING = highest close since set_date × (1 − percent/100), which never falls; null for a trailing stop without any price), high (TRAILING only: the highest close since set_date in today's units; null for FIXED), distance, source, set_date }.` +
  ` target: null or { price (EUR as set, after an ISIN change converted to the successor by its ratio), effective (in today's units after splits since set_date), distance, source, set_date }.` +
  ` distance = effective mark ÷ price − 1 as a ratio (-0.074 = 7.4 % below the price), null without a price; source is free text (null when none), set_date YYYY-MM-DD.`;

/** The `price_marks` object of one Security (snake_case, decimals as strings, dates `YYYY-MM-DD`). Pure. */
export function priceMarksPayload(item: PriceMarksViewItem) {
  const { marks, state } = item;
  const stop = marks?.stop ?? null;
  const target = marks?.target ?? null;
  return {
    basis: "latest close",
    price: state.price,
    price_date: state.priceDate,
    stop:
      stop === null
        ? null
        : {
            type: stop.type,
            price: stop.type === "FIXED" ? stop.value : null,
            percent: stop.type === "TRAILING" ? stop.value : null,
            effective: state.stop?.effective ?? null,
            high: state.stop?.high ?? null,
            distance: state.stop?.distance ?? null,
            source: stop.source,
            set_date: stop.setDate,
          },
    target:
      target === null
        ? null
        : {
            price: target.price,
            effective: state.target?.price ?? null,
            distance: state.target?.distance ?? null,
            source: target.source,
            set_date: target.setDate,
          },
    breached: state.breached,
  };
}

/** The `stop` argument of `set_price_marks`. */
export type StopArg = { type?: string; price?: string; percent?: string; source?: string; set_date?: string };

/** The `target` argument of `set_price_marks`. */
export type TargetArg = { price?: string; source?: string; set_date?: string };

/**
 * The marks service patch of `set_price_marks`: an omitted mark stays omitted (kept), `null` clears it, an
 * object replaces it whole; a stop's value is `percent` for `TRAILING`, else `price`. Values unvalidated. Pure.
 */
export function priceMarksPatchOf(args: { stop?: StopArg | null; target?: TargetArg | null }): PriceMarksPatch {
  const patch: PriceMarksPatch = {};
  if (args.stop !== undefined) {
    patch.stop =
      args.stop === null
        ? null
        : {
            type: args.stop.type,
            value: args.stop.type === "TRAILING" ? args.stop.percent : args.stop.price,
            source: args.stop.source,
            setDate: args.stop.set_date,
          };
  }
  if (args.target !== undefined) {
    patch.target = args.target === null ? null : { price: args.target.price, source: args.target.source, setDate: args.target.set_date };
  }
  return patch;
}

/** The input path of a refused field; the stop value is `stop.percent` for a trailing stop, else `stop.price`. */
export function priceMarkFieldPath(field: PriceMarkField, stopType: unknown): string {
  switch (field) {
    case "stopType":
      return "stop.type";
    case "stopValue":
      return stopType === "TRAILING" ? "stop.percent" : "stop.price";
    case "stopSource":
      return "stop.source";
    case "stopSetDate":
      return "stop.set_date";
    case "targetPrice":
      return "target.price";
    case "targetSource":
      return "target.source";
    case "targetSetDate":
      return "target.set_date";
  }
}

const LABELS: Record<string, string> = {
  "stop.type": "Die Art des Stopps",
  "stop.price": "Der Stoppkurs",
  "stop.percent": "Der Prozentsatz des nachlaufenden Stopps",
  "stop.source": "Die Quelle des Stopps",
  "stop.set_date": "Das Datum des Stopps",
  "target.price": "Das Kursziel",
  "target.source": "Die Quelle des Kursziels",
  "target.set_date": "Das Datum des Kursziels",
};

/** German message for a refused field (`path` from `priceMarkFieldPath`). Pure. */
export function priceMarkMessage(path: string, problem: PriceMarkProblem): string {
  const label = LABELS[path] ?? "Die Eingabe";
  switch (problem) {
    case "required":
      return `${label} fehlt.`;
    case "invalid":
      if (path === "stop.type") return `${label} muss FIXED oder TRAILING sein.`;
      if (path.endsWith(".set_date")) return `${label} muss im Format JJJJ-MM-TT angegeben werden.`;
      if (path.endsWith(".source")) return `${label} muss ein Text sein.`;
      return `${label} muss eine Dezimalzahl mit Punkt sein, z. B. 92.40.`;
    case "not-positive":
      return `${label} muss größer als 0 sein.`;
    case "out-of-range":
      return `${label} muss zwischen ${TRAILING_STOP_MIN_PERCENT} und ${TRAILING_STOP_MAX_PERCENT} liegen.`;
    case "too-long":
      return `${label} darf höchstens ${PRICE_MARK_SOURCE_MAX_LENGTH} Zeichen lang sein.`;
    case "future-date":
      return `${label} darf nicht in der Zukunft liegen.`;
  }
}

/** A `price-marks-invalid` refusal: `{ error, field (input path), problem, message (German) }`. Pure. */
export function priceMarksRefusal(invalid: PriceMarksInvalid, stopType: unknown): CallToolResult {
  const field = priceMarkFieldPath(invalid.field, stopType);
  const payload = { error: "price-marks-invalid", field, problem: invalid.problem, message: priceMarkMessage(field, invalid.problem) };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}
