import Decimal from "decimal.js";
import { parseDecimalInput } from "@/core/decimal-input";
import { formatMoney } from "@/core/format";
import { ALLOWANCE_LIMIT_SINGLE, TEILFREISTELLUNG_RATES } from "@/core/tax";
import type { Broker } from "@/modules/ledger";
import { BROKER_LABELS } from "../depots/labels";

/** Brokers in selection order (client-safe: no runtime import of the ledger module). */
export const TAX_BROKERS = Object.keys(BROKER_LABELS) as Broker[];

export const TAX_SCOPE_HINT =
  "Schätzung – maßgeblich ist die Steuerbescheinigung deiner Bank. Nicht berücksichtigt: Kirchensteuer, Verlustvorträge aus Vorjahren, Vorabpauschale, Anrechnung ausländischer Quellensteuer.";

export const ALLOWANCE_LIMIT_HINT =
  "Die Summe deiner Freistellungsaufträge übersteigt 1.000 € – der gesetzliche Höchstbetrag beträgt 1.000 € für Alleinstehende und 2.000 € für Verheiratete.";

export const ALLOWANCE_AMOUNT_ERROR = "Bitte einen Betrag ab 0 mit höchstens zwei Nachkommastellen eingeben.";
export const ALLOWANCE_YEAR_ERROR = "Bitte ein Jahr zwischen 2000 und 2100 wählen.";
export const TAX_ACTION_FAILED = "Verbindung fehlgeschlagen. Bitte erneut versuchen.";
export const TAX_UNAUTHORIZED = "Sitzung abgelaufen. Bitte erneut anmelden.";
export const TAX_SAVED = "Gespeichert.";

/** A rate as whole percent: `"0.3"` → `"30 %"`, `"0.15"` → `"15 %"`. */
export function ratePercent(rate: string): string {
  return `${new Decimal(rate).times(100).toFixed()} %`;
}

/** Options of the Teilfreistellung select: `""` = automatic, then every allowed rate. */
export function teilfreistellungOptions(automaticRate: string): { value: string; label: string }[] {
  return [{ value: "", label: `Automatisch (${ratePercent(automaticRate)})` }, ...TEILFREISTELLUNG_RATES.map((rate) => ({ value: rate, label: ratePercent(rate) }))];
}

/** Card summary of a fund: "Teilfreistellung 30 % (manuell)" or "… (automatisch)". */
export function teilfreistellungSummary(rate: string, manual: boolean): string {
  return `Teilfreistellung ${ratePercent(rate)} (${manual ? "manuell" : "automatisch"})`;
}

/** A stored amount as German input text: `"300.5"` → `"300,50"`, `"801"` → `"801"`. */
export function amountInputText(amount: string | undefined): string {
  if (amount === undefined) return "";
  const value = new Decimal(amount);
  return value.isInteger() ? value.toFixed(0) : value.toFixed(2).replace(".", ",");
}

/** Live sum of the entered amounts; unparsable or negative fields count as 0. */
export function enteredAllowanceSum(values: readonly string[]): string {
  let sum = new Decimal(0);
  for (const text of values) {
    const parsed = parseDecimalInput(text);
    if (parsed.ok && parsed.value !== "" && !parsed.value.startsWith("-")) sum = sum.plus(parsed.value);
  }
  return sum.toFixed();
}

export function allowanceExceedsLimit(sum: string): boolean {
  return new Decimal(sum).greaterThan(ALLOWANCE_LIMIT_SINGLE);
}

/** Label of the withheld − estimated difference. */
export function differenceLabel(difference: string): string {
  const value = new Decimal(difference);
  if (value.isZero()) return "keine Abweichung";
  return value.isPositive() ? "voraussichtliche Erstattung" : "voraussichtliche Nachbelastung";
}

/** The difference unsigned (the label carries the direction); `""` when there is none. */
export function differenceAmount(difference: string): string {
  const value = new Decimal(difference);
  return value.isZero() ? "" : formatMoney(value.abs());
}

/** The difference unsigned with its label, e.g. "voraussichtliche Erstattung 54,04 €". */
export function differenceText(difference: string): string {
  const amount = differenceAmount(difference);
  return amount === "" ? differenceLabel(difference) : `${differenceLabel(difference)} ${amount}`;
}

export const signedMoney = (value: string) => formatMoney(value, { sign: true });

/** A loss shown as a negative amount (stored positive). */
export const lossMoney = (value: string) => formatMoney(new Decimal(value).negated());
