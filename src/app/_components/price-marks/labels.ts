import { formatDate, formatFigure, formatMoney, formatPercent, formatQuantity } from "@/core/format";
import type { PriceMarkField, PriceMarkProblem, PriceMarkState, PriceMarkWarning, StopMark, StopType } from "@/core/price-marks";

const NBSP = " ";

/** Options of the stop kind select; `""` = no stop. */
export const STOP_TYPE_OPTIONS: readonly { value: StopType | ""; label: string }[] = [
  { value: "", label: "Kein Stopp" },
  { value: "FIXED", label: "Fester Kurs" },
  { value: "TRAILING", label: "Nachlaufend" },
];

const VALUE_FIELDS: readonly PriceMarkField[] = ["stopValue", "targetPrice"];
const DATE_FIELDS: readonly PriceMarkField[] = ["stopSetDate", "targetSetDate"];

/** German message for a refused marks field. */
export function priceMarkErrorMessage(field: PriceMarkField, problem: PriceMarkProblem): string {
  switch (problem) {
    case "required":
      return "Bitte einen Wert eingeben.";
    case "not-positive":
      return "Bitte einen Wert größer als 0 eingeben.";
    case "out-of-range":
      return "Bitte 1 bis 50 % eingeben.";
    case "too-long":
      return "Höchstens 200 Zeichen.";
    case "future-date":
      return "Bitte ein Datum bis heute wählen.";
    case "invalid":
      if (field === "stopType") return "Bitte eine Stoppart wählen.";
      if (VALUE_FIELDS.includes(field)) return "Bitte eine Zahl eingeben, z. B. 92,40.";
      if (DATE_FIELDS.includes(field)) return "Bitte ein gültiges Datum wählen.";
      return "Ungültige Eingabe.";
  }
}

/** German text of a non-blocking warning against the latest Price. */
export function priceMarkWarningText(warning: PriceMarkWarning, latest: string): string {
  return warning === "stop-above-price"
    ? `Der Stopp liegt über dem letzten Kurs (${formatMoney(latest)}) und gilt sofort als unterschritten.`
    : `Das Ziel liegt unter dem letzten Kurs (${formatMoney(latest)}) und gilt sofort als erreicht.`;
}

/** Note on what the marks are checked against. */
export function latestPriceNote(latest: string | null): string {
  return latest === null
    ? "Noch kein Kurs: Kursmarken werden gegen den letzten Kurs geprüft, nicht im Tagesverlauf."
    : `Letzter Kurs ${formatMoney(latest)}. Kursmarken werden gegen den letzten Kurs geprüft, nicht im Tagesverlauf.`;
}

/** The analyst mean price target offered to the target field: only an EUR target can be taken over. */
export type AnalystTargetSuggestion = { mean: string; currency: string | null };

/** Label of the take-over button for an EUR analyst target: "Analystenziel übernehmen (245,00 €)". */
export function analystTargetButtonLabel(mean: string): string {
  return `Analystenziel übernehmen (${formatMoney(mean)})`;
}

/** Hint for an analyst target in another (or an unknown) currency: never converted, never taken over. */
export function analystTargetHint(target: AnalystTargetSuggestion): string {
  return target.currency === null
    ? `Analystenziel: ${formatFigure(target.mean)} – Währung unbekannt, nicht übernehmbar`
    : `Analystenziel: ${formatFigure(target.mean)}${NBSP}${target.currency} – andere Währung, nicht übernehmbar`;
}

/** A canonical decimal as German form input without grouping: `"1234.5"` → `"1234,5"`. */
export function decimalInputText(value: string): string {
  return value.replace(".", ",");
}

/** Card "Kursmarken" (story 12.3) without marks. */
export const NO_PRICE_MARKS_TEXT = "Keine Kursmarken";

/** Card note on what the marks are checked against. */
export const PRICE_MARKS_NOTE = "geprüft gegen den letzten Kurs, nicht im Tagesverlauf";

const SEPARATOR = " · ";

/** `value · distance` of a mark; the distance is omitted when unknown. */
function valueAndDistance(value: string, distance: string | null): string {
  return distance === null ? formatMoney(value) : `${formatMoney(value)}${SEPARATOR}${formatPercent(distance, 1)}`;
}

/**
 * The stop row of the card: `Stopp · 92,40 € · -7,4 %`; trailing `Stopp nachlaufend 15 % · 92,40 € · -7,4 %`
 * (`Stopp nachlaufend 15 % · noch kein Kurs` without any Price). Value and distance come from the state.
 */
export function stopRowText(stop: Pick<StopMark, "type" | "value">, state: NonNullable<PriceMarkState["stop"]>): string {
  const label = stop.type === "FIXED" ? "Stopp" : `Stopp nachlaufend ${formatQuantity(stop.value)}${NBSP}%`;
  if (state.effective === null) return `${label}${SEPARATOR}noch kein Kurs`;
  return `${label}${SEPARATOR}${valueAndDistance(state.effective, state.distance)}`;
}

/** The target row of the card: `Ziel · 245,00 € · +8,1 %` (distance omitted without a Price). */
export function targetRowText(state: NonNullable<PriceMarkState["target"]>): string {
  return `Ziel${SEPARATOR}${valueAndDistance(state.price, state.distance)}`;
}

/** The line under a mark: `Quelle: Börse Online · gesetzt am 01.10.2026` (source part omitted without one). */
export function markMetaText(mark: { source: string | null; setDate: string }): string {
  const set = `gesetzt am ${formatDate(mark.setDate)}`;
  return mark.source === null ? set : `Quelle: ${mark.source}${SEPARATOR}${set}`;
}

/** The breach pill: `Stopp unterschritten · Kurs vom 10.11.2026` / `Ziel erreicht · Kurs vom 10.11.2026`. */
export function breachPillText(breach: "stop" | "target", priceDate: string): string {
  return `${breach === "stop" ? "Stopp unterschritten" : "Ziel erreicht"}${SEPARATOR}Kurs vom ${formatDate(priceDate)}`;
}

/** Dashboard card (story 12.4) listing every Security whose marks are breached. */
export const BREACHED_MARKS_HEADING = "Kursmarken erreicht";
