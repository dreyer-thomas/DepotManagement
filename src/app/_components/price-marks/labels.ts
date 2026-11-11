import { formatFigure, formatMoney } from "@/core/format";
import type { PriceMarkField, PriceMarkProblem, PriceMarkWarning, StopType } from "@/core/price-marks";

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
