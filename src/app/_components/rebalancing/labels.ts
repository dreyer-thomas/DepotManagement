import Decimal from "decimal.js";
import { parseDecimalInput } from "@/core/decimal-input";
import { formatMoney, formatPercentagePoints, formatQuantity } from "@/core/format";
import type { BuyInstrument, Segment } from "@/core/rebalancing";

/** German segment labels in display order (keys as `core/rebalancing` `SEGMENTS`). */
export const SEGMENT_LABELS: Record<Segment, string> = {
  equityUsa: "Aktien USA",
  equityEurope: "Aktien Europa",
  equityJapan: "Aktien Japan",
  equityPacificExJapan: "Aktien Pazifik ohne Japan",
  equityEmerging: "Aktien Schwellenländer",
  bonds: "Anleihen",
  commodities: "Gold/Rohstoffe",
  realEstate: "Immobilien",
  crypto: "Krypto",
  cash: "Geldmarkt/Cash",
};

/** Segments in display order (client-safe copy of the keys). */
export const SEGMENT_KEYS = Object.keys(SEGMENT_LABELS) as Segment[];

export const TARGETS_HEADING = "Zielallokation";
export const ACTUAL_HEADING = "Ist und Ziel";
export const PROPOSAL_HEADING = "Rebalancing-Vorschlag";
export const NO_TARGETS_TEXT = "Noch keine Zielallokation gespeichert.";
export const IN_RANGE_LABEL = "im Rahmen";
export const UNASSIGNED_LABEL = "Nicht zugeordnet";
export const UNASSIGNED_HINT = "Passt in kein Segment (z. B. Sonstige Regionen, Welt-Fonds ohne Aufteilung, Mischfonds) – zuordnen auf der Wertpapier-Seite.";
export const TOTAL_LABEL = "Summe";
export const THRESHOLD_LABEL = "Schwelle (Prozentpunkte)";
export const DEPOSIT_LABEL = "Neue Einzahlung (€)";
export const DEPOSIT_INVALID = "Ungültiger Betrag";
export const CASH_INSTRUMENT = "Als Guthaben halten";
export const NO_INSTRUMENT = "Kein Bestand";
export const CASH_SALE = "Guthaben";
export const ALSO_SOLD_HINT = "Wird in diesem Vorschlag auch verkauft – Kauf und Verkauf gegeneinander aufrechnen.";
export const PROPOSAL_HINT =
  "Vorschlag – es wird nichts gebucht. Steuern geschätzt nach Freistellungsauftrag und Verlusttöpfen (siehe Analysen › Steuern).";
export const TARGET_SAVED = "Gespeichert.";

export const TARGET_ERRORS = {
  "target-sum": "Die Zielwerte müssen zusammen 100 % ergeben.",
  "target-invalid": "Bitte einen Wert von 0 bis 100 mit höchstens zwei Nachkommastellen eingeben.",
  "threshold-invalid": "Bitte eine Schwelle von 0 bis 100 Prozentpunkten mit höchstens zwei Nachkommastellen eingeben.",
  "scope-not-found": "Diesen Bereich gibt es nicht mehr. Bitte die Seite neu laden.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "action-failed": "Verbindung fehlgeschlagen. Bitte erneut versuchen.",
} as const;

/** A stored percent as German input text: `"60.5"` → `"60,5"`; `"0"` → `""` (empty = 0). */
export function percentInputText(value: string | undefined): string {
  if (value === undefined || new Decimal(value).isZero()) return "";
  return value.replace(".", ",");
}

/** A stored threshold as German input text: `"2"` → `"2"`, `"1.5"` → `"1,5"`. */
export function thresholdInputText(value: string): string {
  return value.replace(".", ",");
}

/** Live sum of the entered percentages; unparsable or negative fields count as 0. */
export function enteredTargetSum(values: readonly string[]): string {
  let sum = new Decimal(0);
  for (const text of values) {
    const parsed = parseDecimalInput(text);
    if (parsed.ok && parsed.value !== "" && !parsed.value.startsWith("-")) sum = sum.plus(parsed.value);
  }
  return sum.toFixed();
}

/** A percent value (not a ratio) with up to two decimals: `"60.5"` → `"60,5 %"`. */
export function percentText(percent: string): string {
  return `${formatQuantity(new Decimal(percent).toDecimalPlaces(2, Decimal.ROUND_HALF_UP))}\u00a0%`;
}

/** `Summe: 99,5 %`. */
export function sumText(sum: string): string {
  return `Summe: ${percentText(sum)}`;
}

/** A deviation in percentage points (signed): `"1.5"` → `"+1,50 Pp."`. */
export function pointsText(points: string): string {
  return formatPercentagePoints(new Decimal(points).dividedBy(100));
}

export const signedMoney = (value: string) => formatMoney(value, { sign: true });

/**
 * `?deposit=`: German or plain amount ≥ 0 with at most two decimals. Absent or empty → 0; anything else
 * invalid → 0 with `invalid: true` (the view shows "Ungültiger Betrag"). `text` is the raw input to refill the field.
 */
export function parseDepositParam(value: string | string[] | undefined): { deposit: string; invalid: boolean; text: string } {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = raw ?? "";
  const parsed = parseDecimalInput(text);
  if (!parsed.ok) return { deposit: "0", invalid: true, text };
  if (parsed.value === "") return { deposit: "0", invalid: false, text };
  const amount = new Decimal(parsed.value);
  if (amount.isNegative() || amount.decimalPlaces() > 2) return { deposit: "0", invalid: true, text };
  return { deposit: amount.isZero() ? "0" : amount.toFixed(), invalid: false, text };
}

/** The suggested instrument of a buy: the Security's name, "Als Guthaben halten" or "Kein Bestand". */
export function instrumentText(instrument: BuyInstrument, securityNames: Readonly<Record<string, string>>): string {
  if (instrument === null) return NO_INSTRUMENT;
  if (instrument.kind === "cash") return CASH_INSTRUMENT;
  return securityNames[instrument.securityId] ?? instrument.securityId;
}

/** Saldo Guthaben with its direction: "+12,00 € (bleibt als Guthaben)" / "-5,00 € (aus Guthaben)". */
export function cashLeftText(cashLeft: string): string {
  const value = new Decimal(cashLeft);
  if (value.isZero()) return formatMoney("0");
  return `${signedMoney(cashLeft)} (${value.isPositive() ? "bleibt als Guthaben" : "aus Guthaben"})`;
}
