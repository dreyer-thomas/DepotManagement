import { formatDate, formatDateTime } from "@/core/format";
import type { PriceSource } from "@/core/prices";
import { PROVIDER_LABELS } from "@/app/_components/securities/labels";

const NBSP = "\u00a0";

/** What the date line, stale badge and tooltip need to know about a resolved price. */
export type PriceDateInfo = {
  date: string;
  source: PriceSource;
  /** UTC ISO fetch / entry time; null for a Transaction price. */
  fetchedAt: string | null;
  /** Provider of a provider price (e.g. `YAHOO`); null otherwise. */
  provider: string | null;
  stale: boolean;
};

/** German display name of a provider (`YAHOO` → "Yahoo Finance"); unknown values are shown as they are. */
export function providerLabel(provider: string | null): string {
  if (!provider) return "Kursanbieter";
  return (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;
}

/** "Kurs vom 22.10.2026", stale: "Kurs vom 22.10.2026 – veraltet". */
export function priceDateText(date: string, stale: boolean): string {
  return `Kurs vom ${formatDate(date)}${stale ? " – veraltet" : ""}`;
}

/**
 * Tooltip text naming the source and fetch time: "Yahoo Finance · abgerufen 23.10.2026, 20:05",
 * "Manuell eingetragen · 23.10.2026, 20:05" or "Buchungskurs".
 */
export function priceSourceText({ source, fetchedAt, provider }: Pick<PriceDateInfo, "source" | "fetchedAt" | "provider">): string {
  if (source === "transaction") return "Buchungskurs";
  const time = fetchedAt ? formatDateTime(fetchedAt) : null;
  if (source === "manual") return time ? `Manuell eingetragen · ${time}` : "Manuell eingetragen";
  return time ? `${providerLabel(provider)} · abgerufen ${time}` : providerLabel(provider);
}

const EXCHANGE_HINT = "Bitte ein Symbol mit Börsenkürzel wählen, z. B. .DE (Xetra) oder .F (Frankfurt).";

/** Why a fetch failed (`PriceFetchFailure`), with a hint for Yahoo symbols where it helps; unknown reasons say nothing. */
export function fetchFailureText(reason: string | null | undefined, provider: string | null): string | null {
  const yahoo = provider === "YAHOO";
  switch (reason) {
    case "currency":
      return `Keine Kurse in EUR für dieses Symbol.${yahoo ? ` ${EXCHANGE_HINT}` : ""}`;
    case "not-found":
      return `Symbol unbekannt oder keine Kurse im Zeitraum.${yahoo ? ` ${EXCHANGE_HINT}` : ""}`;
    case "network":
      return "Anbieter nicht erreichbar, bitte später erneut versuchen.";
    case "schema":
    case "unexpected":
      return "Unerwartete Antwort des Anbieters.";
    default:
      return null;
  }
}

/** Row-level fetch failure: "Kurs konnte nicht von Yahoo Finance geladen werden." plus the reason when known. */
export function fetchErrorText(provider: string | null, reason?: string | null): string {
  const why = fetchFailureText(reason, provider);
  return `Kurs konnte nicht von ${providerLabel(provider)} geladen werden.${why ? ` ${why}` : ""}`;
}

/** Snackbar after "Kurse aktualisieren", naming every failed Security. */
export function refreshResultText(failedNames: readonly string[]): string {
  return failedNames.length === 0 ? "Kurse aktualisiert." : `Kurse aktualisiert. Fehlgeschlagen: ${failedNames.join(", ")}`;
}

/** `price-not-found`: the edited or deleted manual Price no longer exists (service reason `not-found`). */
export type ManualPriceErrorReason =
  | "not-found"
  | "price-not-found"
  | "date-invalid"
  | "price-invalid"
  | "date-taken"
  | "unauthorized";

const MANUAL_PRICE_ERRORS: Record<ManualPriceErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "price-not-found": "Manueller Kurs nicht gefunden.",
  "date-taken": "Für dieses Datum gibt es bereits einen manuellen Kurs.",
  "date-invalid": "Bitte ein gültiges Datum bis heute wählen.",
  "price-invalid": "Bitte einen Kurs größer als 0 eingeben, z. B. 12,34.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a failed manual-price entry. */
export function manualPriceErrorMessage(reason: ManualPriceErrorReason): string {
  return MANUAL_PRICE_ERRORS[reason];
}

/** German digits of a stored decimal with every stored decimal place: `"1234.5"` → `"1.234,5"`. */
function germanDecimal(value: string, grouped: boolean): string {
  const [integer, fraction] = value.split(".");
  const digits = grouped ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : integer;
  return fraction ? `${digits},${fraction}` : digits;
}

/** A stored manual Price for display: `"1234.5"` → `"1.234,5 €"` (no rounding, all stored decimals). */
export function manualPriceText(price: string): string {
  return `${germanDecimal(price, true)}${NBSP}€`;
}

/** A stored manual Price as edit-field text: `"1234.5"` → `"1234,5"` (no grouping). */
export function manualPriceInputText(price: string): string {
  return germanDecimal(price, false);
}

/** Delete confirmation: "Manuellen Kurs vom 20.10.2026 für SAP SE löschen?" */
export function deleteManualPriceConfirmText(date: string, securityName: string): string {
  return `Manuellen Kurs vom ${formatDate(date)} für ${securityName} löschen?`;
}
