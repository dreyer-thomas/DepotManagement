/**
 * The Period: the date range every Period figure, chart and return covers. Pure; "today" is passed in.
 * Serialized form (cookie): `1M | YTD | 1J | 3J | MAX` or `custom:YYYY-MM-DD:YYYY-MM-DD`.
 */
import { addMonths, isBusinessDate } from "./dates";
import { formatDate } from "./format";

export const PERIOD_PRESETS = ["1M", "YTD", "1J", "3J", "MAX"] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export type PeriodSelection = { kind: "preset"; preset: PeriodPreset } | { kind: "custom"; from: string; to: string };

/** Default and fallback for a missing or invalid stored Period. */
export const DEFAULT_PERIOD: PeriodSelection = { kind: "preset", preset: "1J" };

const PRESET_LABELS: Record<PeriodPreset, string> = { "1M": "1M", YTD: "YTD", "1J": "1J", "3J": "3J", MAX: "Max" };

const CUSTOM = /^custom:([^:]*):([^:]*)$/;

function isPreset(value: string): value is PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(value);
}

/**
 * Parses a serialized Period. A custom range needs two business dates with `from ≤ to ≤ today`;
 * anything else is `null` (callers fall back to `DEFAULT_PERIOD`).
 */
export function parsePeriod(text: unknown, today: string): PeriodSelection | null {
  if (typeof text !== "string") return null;
  if (isPreset(text)) return { kind: "preset", preset: text };
  const match = CUSTOM.exec(text);
  if (!match) return null;
  const [, from, to] = match;
  if (!isBusinessDate(from) || !isBusinessDate(to) || from > to || to > today) return null;
  return { kind: "custom", from, to };
}

/** The serialized form `parsePeriod` reads back. */
export function serializePeriod(selection: PeriodSelection): string {
  return selection.kind === "preset" ? selection.preset : `custom:${selection.from}:${selection.to}`;
}

/**
 * The inclusive date range of a Period. Presets end today: `1M`/`1J`/`3J` start 1 month / 1 year /
 * 3 years earlier (day clamped to month end), `YTD` on Jan 1 of today's year, `MAX` on `firstDate`
 * (the Depot's first ledger date; today without one). A custom range is returned as is.
 */
export function resolvePeriod(selection: PeriodSelection, today: string, firstDate: string | null): { from: string; to: string } {
  if (selection.kind === "custom") return { from: selection.from, to: selection.to };
  const to = today;
  switch (selection.preset) {
    case "1M":
      return { from: addMonths(to, -1), to };
    case "YTD":
      return { from: `${to.slice(0, 4)}-01-01`, to };
    case "1J":
      return { from: addMonths(to, -12), to };
    case "3J":
      return { from: addMonths(to, -36), to };
    case "MAX":
      return { from: firstDate !== null && firstDate < to ? firstDate : to, to };
  }
}

/** Display label: the preset (`1J`, `Max`, …) or the custom range `01.01.2026 – 30.06.2026`. */
export function periodLabel(selection: PeriodSelection): string {
  return selection.kind === "preset"
    ? PRESET_LABELS[selection.preset]
    : `${formatDate(selection.from)} – ${formatDate(selection.to)}`;
}
